"""Pure job handling: envelope → graph → artifact → validated result.

This is the testable core of the worker, independent of BullMQ/Redis. It:

* VALIDATES the incoming ``JobEnvelope`` against the generated Pydantic model
  (runtime conformance, ADR-0011) — a bad envelope is a *terminal* failure.
* runs the trivial LangGraph stub / deterministic narrative (ADR-0003 scope),
* emits step-based progress via an injected callback (ADR-0007 §4),
* claim-checks the artifact to S3 and returns a validated ``JobResult``
  (pointer + thin summary, ADR-0004 §4 / ADR-0007 §5).

The worker stays a stateless reader (ADR-0004): it never writes Postgres, and
the two spec-06 showcase jobs (market brief, announcement summary) fetch
whatever Postgres-backed context they need via the injected ``BackendClient``
(NestJS's own anonymous read endpoints) rather than a direct DB connection.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Callable

from pydantic import ValidationError

from .announcement_summary import compose_announcement_summary
from .artifacts import ArtifactStore
from .backend_client import BackendClient
from .config import (
    ANNOUNCEMENT_SUMMARY_JOB_ID_PREFIX,
    JOB_ANALYZE_FUNDAMENTAL,
    JOB_ANALYZE_TECHNICAL,
    JOB_GENERATE_MARKET_BRIEF,
    JOB_SUMMARIZE_ANNOUNCEMENT,
    MARKET_BRIEF_JOB_ID_PREFIX,
)
from .contracts_generated import (
    AnnouncementSummaryJobEnvelope,
    FundamentalJobEnvelope,
    JobProgress,
    JobResult,
    MarketBriefJobEnvelope,
    Summary,
    SystemSummary,
    TechnicalJobEnvelope,
)
from .graph import run_analysis
from .logging_config import get_logger
from .market_brief import compose_market_brief

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
    backend_client: BackendClient,
) -> JobResult:
    """Process one job and return a contract-valid ``JobResult``.

    ``job_name`` selects the envelope model and dispatches to the job
    family's handling. ``raw_envelope`` is the untrusted wire payload.
    ``backend_client`` is only used by the system-triggered showcase jobs
    (market brief, announcement summary); the TA/FA jobs ignore it.
    """
    if job_name in (JOB_ANALYZE_TECHNICAL, JOB_ANALYZE_FUNDAMENTAL):
        return _handle_analysis_job(
            job_name, raw_envelope, artifact_store, report_progress
        )
    if job_name == JOB_GENERATE_MARKET_BRIEF:
        return _handle_market_brief(
            raw_envelope, artifact_store, report_progress, backend_client
        )
    if job_name == JOB_SUMMARIZE_ANNOUNCEMENT:
        return _handle_announcement_summary(
            raw_envelope, artifact_store, report_progress, backend_client
        )
    raise TerminalJobError(f"Unknown job name: {job_name!r}")


def _handle_analysis_job(
    job_name: str,
    raw_envelope: dict,
    artifact_store: ArtifactStore,
    report_progress: ProgressReporter,
) -> JobResult:
    """TA/FA: the original scaffold path (ADR-0003 stub verdict/headline)."""
    if job_name == JOB_ANALYZE_TECHNICAL:
        envelope_model, kind = TechnicalJobEnvelope, "technical"
        phases = ("queued", "fetching-market-data", "computing-indicators")
        job_prefix, anchor = "ta", "timeframe"
    else:
        envelope_model, kind = FundamentalJobEnvelope, "fundamental"
        phases = ("queued", "fetching-financials", "computing-metrics")
        job_prefix, anchor = "fa", "period"

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


def _handle_market_brief(
    raw_envelope: dict,
    artifact_store: ArtifactStore,
    report_progress: ProgressReporter,
    backend_client: BackendClient,
) -> JobResult:
    """Daily market brief (spec 06, ticket 02) — verdict-less ``SystemSummary``.

    No symbol/timeframe anchor: fetches the headline + sector index panel via
    the NestJS market-overview read API (ADR-0004) and narrates it, flagging
    the underlying series as illustrative/synthetic throughout.
    """
    try:
        envelope = MarketBriefJobEnvelope.model_validate(raw_envelope)
    except ValidationError as exc:
        raise TerminalJobError(f"Envelope failed contract validation: {exc}") from exc

    correlation_id = str(envelope.correlationId)
    log = get_logger(__name__, correlation_id=correlation_id)
    # Content-derived jobId keyed by date (ADR-0007 §2): re-enqueuing the same
    # day collapses to the existing job rather than piling up duplicates.
    day_bucket = envelope.asOf.astimezone(timezone.utc).strftime("%Y-%m-%d")
    job_id = f"{MARKET_BRIEF_JOB_ID_PREFIX}{day_bucket}"
    log.info(
        "job.start", extra={"jobId": job_id, "jobName": JOB_GENERATE_MARKET_BRIEF}
    )

    total = 4
    report_progress(_progress(0, total, "queued", "Queued"))
    report_progress(
        _progress(1, total, "fetching-market-data", "Fetching index data")
    )
    indices_response = backend_client.get_market_indices()
    brief = compose_market_brief(indices_response.get("indices", []))
    report_progress(
        _progress(2, total, "drafting-narrative", "Drafting market brief")
    )

    key_suffix = f"brief/{day_bucket}.json"
    pointer = artifact_store.put_artifact(
        key_suffix,
        {
            "schemaVersion": "brief-1",
            "headline": brief["headline"],
            "lines": brief["lines"],
            "illustrative": brief["illustrative"],
        },
    )
    report_progress(_progress(3, total, "persisting-artifact", "Persisting artifact"))
    log.info(
        "job.artifact_written",
        extra={"jobId": job_id, "bucket": pointer.bucket, "key": pointer.key},
    )

    result = JobResult(
        correlationId=envelope.correlationId,
        jobId=job_id,
        pointer=pointer,
        summary=SystemSummary(headline=brief["headline"], asOf=envelope.asOf),
        at=_now(),
    )
    report_progress(_progress(4, total, "done", "Done"))
    log.info("job.done", extra={"jobId": job_id})
    return result


def _handle_announcement_summary(
    raw_envelope: dict,
    artifact_store: ArtifactStore,
    report_progress: ProgressReporter,
    backend_client: BackendClient,
) -> JobResult:
    """Announcement AI summary (spec 06, ticket 03) — verdict-less ``SystemSummary``.

    Fetches the announcement's own structured metadata via the NestJS read API
    (ADR-0004) — the payload carries only the anchoring ``announcementId``, no
    bulk disclosure text rides the queue.
    """
    try:
        envelope = AnnouncementSummaryJobEnvelope.model_validate(raw_envelope)
    except ValidationError as exc:
        raise TerminalJobError(f"Envelope failed contract validation: {exc}") from exc

    correlation_id = str(envelope.correlationId)
    log = get_logger(__name__, correlation_id=correlation_id)
    announcement_id = str(envelope.payload.announcementId)
    # Content-derived jobId (ADR-0007 §2): one job per announcement, independent
    # of asOf — a legitimate re-summarize overwrites the same Postgres row
    # rather than needing a distinct job history.
    job_id = f"{ANNOUNCEMENT_SUMMARY_JOB_ID_PREFIX}{announcement_id}"
    log.info(
        "job.start",
        extra={"jobId": job_id, "jobName": JOB_SUMMARIZE_ANNOUNCEMENT},
    )

    total = 4
    report_progress(_progress(0, total, "queued", "Queued"))
    report_progress(
        _progress(1, total, "fetching-announcement", "Fetching announcement")
    )
    announcement = backend_client.get_announcement(announcement_id)
    summary = compose_announcement_summary(announcement)
    report_progress(_progress(2, total, "summarizing", "Summarizing announcement"))

    as_of_bucket = envelope.asOf.astimezone(timezone.utc).strftime("%Y-%m-%dT%H")
    key_suffix = f"announcement/{announcement_id}/{as_of_bucket}.json"
    pointer = artifact_store.put_artifact(
        key_suffix,
        {
            "schemaVersion": "announcement-summary-1",
            "announcementId": announcement_id,
            "headline": summary["headline"],
            "category": summary["category"],
            "sourceTitle": summary["sourceTitle"],
        },
    )
    report_progress(_progress(3, total, "persisting-artifact", "Persisting artifact"))
    log.info(
        "job.artifact_written",
        extra={"jobId": job_id, "bucket": pointer.bucket, "key": pointer.key},
    )

    result = JobResult(
        correlationId=envelope.correlationId,
        jobId=job_id,
        pointer=pointer,
        summary=SystemSummary(headline=summary["headline"], asOf=envelope.asOf),
        at=_now(),
    )
    report_progress(_progress(4, total, "done", "Done"))
    log.info("job.done", extra={"jobId": job_id})
    return result
