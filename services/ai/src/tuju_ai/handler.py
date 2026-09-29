"""Pure job handling: envelope → graph → artifact → validated result.

This is the testable core of the worker, independent of BullMQ/Redis. It:

* VALIDATES the incoming ``JobEnvelope`` against the generated Pydantic model
  (runtime conformance, ADR-0011) — a bad envelope is a *terminal* failure.
* runs the trivial LangGraph stub (ADR-0003 scope),
* emits step-based progress via an injected callback (ADR-0007 §4),
* claim-checks the artifact to S3 and returns a validated ``JobResult``
  (pointer + thin summary, ADR-0004 §4 / ADR-0007 §5).

The worker stays a stateless reader (ADR-0004): it never writes Postgres.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Callable

from pydantic import ValidationError

from .artifacts import ArtifactStore
from .config import JOB_ANALYZE_FUNDAMENTAL, JOB_ANALYZE_TECHNICAL
from .contracts_generated import (
    FundamentalJobEnvelope,
    JobProgress,
    JobResult,
    Summary,
    TechnicalJobEnvelope,
)
from .graph import run_analysis
from .logging_config import get_logger

# Injected progress reporter: takes a validated JobProgress. In the worker this
# maps to BullMQ ``job.updateProgress``; in tests it collects the sequence.
ProgressReporter = Callable[[JobProgress], None]


class TerminalJobError(Exception):
    """Bad input / unrecoverable — do NOT retry (maps to BullMQ UnrecoverableError)."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _progress(step: int, total: int, phase: str, label: str) -> JobProgress:
    return JobProgress(
        stepIndex=step, stepTotal=total, phase=phase, label=label, at=_now()
    )


def handle_job(
    job_name: str,
    raw_envelope: dict,
    *,
    artifact_store: ArtifactStore,
    report_progress: ProgressReporter,
) -> JobResult:
    """Process one job and return a contract-valid ``JobResult``.

    ``job_name`` selects the technical vs fundamental envelope model and the
    job-type-specific phase enum. ``raw_envelope`` is the untrusted wire payload.
    """
    if job_name == JOB_ANALYZE_TECHNICAL:
        envelope_model, kind = TechnicalJobEnvelope, "technical"
        phases = ("queued", "fetching-market-data", "computing-indicators")
        job_prefix, anchor = "ta", "timeframe"
    elif job_name == JOB_ANALYZE_FUNDAMENTAL:
        envelope_model, kind = FundamentalJobEnvelope, "fundamental"
        phases = ("queued", "fetching-financials", "computing-metrics")
        job_prefix, anchor = "fa", "period"
    else:
        raise TerminalJobError(f"Unknown job name: {job_name!r}")

    # --- Runtime conformance: validate the incoming envelope (ADR-0011) -------
    try:
        envelope = envelope_model.model_validate(raw_envelope)
    except ValidationError as exc:
        raise TerminalJobError(f"Envelope failed contract validation: {exc}") from exc

    correlation_id = str(envelope.correlationId)
    log = get_logger(__name__, correlation_id=correlation_id)
    symbol = envelope.payload.symbol
    anchor_value = getattr(envelope.payload, anchor)
    # Content-derived jobId for idempotency (ADR-0007 §2), asOf bucketed to the hour.
    as_of_bucket = envelope.asOf.astimezone(timezone.utc).strftime("%Y-%m-%dT%H")
    job_id = f"{job_prefix}:{symbol}:{anchor_value}:{as_of_bucket}"
    log.info("job.start", extra={"jobId": job_id, "jobName": job_name, "symbol": symbol})

    total = 5
    report_progress(_progress(0, total, phases[0], "Queued"))
    report_progress(_progress(1, total, phases[1], f"Fetching data for {symbol}"))
    report_progress(_progress(2, total, phases[2], "Computing (stub)"))

    # --- Trivial graph stub (no real TA/FA logic) -----------------------------
    result_state = run_analysis(kind, symbol)
    report_progress(_progress(3, total, "synthesizing-verdict", "Synthesizing verdict"))

    # --- Claim-check the artifact to S3 (ADR-0004) ----------------------------
    key_suffix = f"{job_prefix}/{symbol}/{as_of_bucket}.json"
    pointer = artifact_store.put_artifact(key_suffix, result_state["artifact"])
    report_progress(
        _progress(4, total, "persisting-artifact", "Persisting artifact")
    )
    log.info(
        "job.artifact_written",
        extra={"jobId": job_id, "bucket": pointer.bucket, "key": pointer.key},
    )

    # --- Thin summary + validated result (ADR-0007 §5) ------------------------
    result = JobResult(
        correlationId=envelope.correlationId,
        jobId=job_id,
        pointer=pointer,
        summary=Summary(
            verdict=result_state["verdict"],
            headline=result_state["headline"],
            asOf=envelope.asOf,
        ),
        at=_now(),
    )
    report_progress(_progress(5, total, "done", "Done"))
    log.info("job.done", extra={"jobId": job_id, "verdict": result.summary.verdict})
    return result
