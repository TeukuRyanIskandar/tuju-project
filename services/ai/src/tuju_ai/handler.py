"""Pure job handling: envelope → graph → artifact → validated result.

This is the testable core of the worker, independent of BullMQ/Redis. It:

* VALIDATES the incoming ``JobEnvelope`` against the generated Pydantic model
  (runtime conformance, ADR-0011) — a bad envelope is a *terminal* failure.
* runs the TA/FA handlers (``ta_fa_analysis``) and the deterministic
  showcase narratives,
* emits step-based progress via an injected callback (ADR-0007 §4),
* claim-checks the artifact to S3 and returns a validated ``JobResult``
  (pointer + thin summary, ADR-0004 §4 / ADR-0007 §5).

The worker stays a stateless reader (ADR-0004): it never writes Postgres, and
the two spec-06 showcase jobs (market brief, announcement summary) fetch
whatever Postgres-backed context they need via the injected ``BackendClient``
(NestJS's own anonymous read endpoints) rather than a direct DB connection.
"""

from __future__ import annotations

import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Callable, Iterator

import httpx
from pydantic import ValidationError

from .announcement_summary import compose_announcement_summary
from .artifacts import ArtifactStore
from .backend_client import BackendClient
from .config import (
    ANNOUNCEMENT_SUMMARY_JOB_ID_PREFIX,
    JOB_ANALYZE_FUNDAMENTAL,
    JOB_ANALYZE_PROSPECTUS,
    JOB_ANALYZE_TECHNICAL,
    JOB_GENERATE_MARKET_BRIEF,
    JOB_SUMMARIZE_ANNOUNCEMENT,
    MARKET_BRIEF_JOB_ID_PREFIX,
    PROSPECTUS_JOB_ID_PREFIX,
)
from .contracts_generated import (
    AnnouncementSummaryJobEnvelope,
    FundamentalJobEnvelope,
    JobProgress,
    JobResult,
    MarketBriefJobEnvelope,
    ProspectusArtifact,
    ProspectusJobEnvelope,
    Summary,
    SystemSummary,
    TechnicalJobEnvelope,
)
from .graph import run_analysis
from .logging_config import get_logger
from .llm import (
    CostCeilingExceeded,
    CostTracker,
    LLMConfigError,
    LLMPermanentError,
)
from .market_brief import compose_market_brief
from .ta_fa_analysis import _handle_fundamental_job, _handle_technical_job
from .prospectus.analysis import (
    LLM_STEPS,
    STEP_BUSINESS,
    STEP_CORNERSTONE,
    STEP_FINANCIALS,
    STEP_LOCKUP,
    STEP_OFFER,
    STEP_RELATED_PARTY,
    STEP_RISKS,
    STEP_WATCH,
    MalformedModelOutput,
    analyze_prospectus,
)
from .prospectus.analysis_models import IpoReference
from .prospectus.job import MISSING_KEY_MESSAGE, ProspectusRuntime
from .prospectus.router import route_sections
from .prospectus.store import ensure_parse

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
    prospectus_runtime: ProspectusRuntime | None = None,
) -> JobResult:
    """Process one job and return a contract-valid ``JobResult``.

    ``job_name`` selects the envelope model and dispatches to the job
    family's handling. ``raw_envelope`` is the untrusted wire payload.
    ``backend_client`` is used by the TA/FA jobs (reference reads) and the
    system-triggered showcase jobs (market brief, announcement summary,
    prospectus).
    ``prospectus_runtime`` (LLM client, parse fn, cost ceiling) is only used by
    ``analyze-prospectus``; ``None`` behaves as "no API key configured".
    """
    if job_name == JOB_ANALYZE_TECHNICAL:
        return _handle_technical_job(
            raw_envelope, artifact_store, report_progress, backend_client
        )
    if job_name == JOB_ANALYZE_FUNDAMENTAL:
        return _handle_fundamental_job(
            raw_envelope, artifact_store, report_progress, backend_client
        )
    if job_name == JOB_GENERATE_MARKET_BRIEF:
        return _handle_market_brief(
            raw_envelope, artifact_store, report_progress, backend_client
        )
    if job_name == JOB_SUMMARIZE_ANNOUNCEMENT:
        return _handle_announcement_summary(
            raw_envelope, artifact_store, report_progress, backend_client
        )
    if job_name == JOB_ANALYZE_PROSPECTUS:
        return _handle_prospectus(
            raw_envelope,
            artifact_store,
            report_progress,
            backend_client,
            prospectus_runtime or ProspectusRuntime(),
        )
    raise TerminalJobError(f"Unknown job name: {job_name!r}")


# NOTE: stub kept for reference; replaced by ta_fa_analysis. See graph.py.
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


@contextmanager
def _heartbeat(
    report: ProgressReporter,
    make_event: Callable[[], JobProgress],
    interval: float,
) -> Iterator[None]:
    """Re-emit the current step's progress every ``interval`` s while a long
    blocking step (the 4-11 min first-run Docling parse) runs, so subscribers
    see the job is alive. Same ``stepIndex``/``phase``, fresh ``at``."""
    stop = threading.Event()

    def beat() -> None:
        while not stop.wait(interval):
            report(make_event())

    thread = threading.Thread(target=beat, name="progress-heartbeat", daemon=True)
    thread.start()
    try:
        yield
    finally:
        stop.set()
        thread.join(timeout=5)


# Progress plan for analyze-prospectus (ADR-0007 §4: step-based, fixed phases).
_PROSPECTUS_STEPS: list[tuple[str, str]] = [
    ("queued", "Queued"),
    ("fetching-prospectus", "Fetching prospectus"),
    ("parsing-document", "Parsing document"),
    ("analyzing-sections", "Analyzing offer details"),  # STEP_OFFER
    ("analyzing-sections", "Summarizing the business"),  # STEP_BUSINESS
    ("analyzing-sections", "Reading financials"),  # STEP_FINANCIALS
    ("analyzing-sections", "Ranking risk factors"),  # STEP_RISKS
    ("analyzing-sections", "Finding cornerstone investors"),  # STEP_CORNERSTONE
    ("analyzing-sections", "Checking share lock-ups"),  # STEP_LOCKUP
    ("analyzing-sections", "Reviewing related-party transactions"),  # STEP_RELATED_PARTY
    ("synthesizing-watchlist", "Synthesizing what to watch"),  # STEP_WATCH
    ("persisting-artifact", "Persisting artifact"),
    ("done", "Done"),
]
_PROSPECTUS_TOTAL = len(_PROSPECTUS_STEPS) - 1
_STEP_INDEX = {
    STEP_OFFER: 3,
    STEP_BUSINESS: 4,
    STEP_FINANCIALS: 5,
    STEP_RISKS: 6,
    STEP_CORNERSTONE: 7,
    STEP_LOCKUP: 8,
    STEP_RELATED_PARTY: 9,
    STEP_WATCH: 10,
}
assert set(_STEP_INDEX) == set(LLM_STEPS)


def _handle_prospectus(
    raw_envelope: dict,
    artifact_store: ArtifactStore,
    report_progress: ProgressReporter,
    backend_client: BackendClient,
    runtime: ProspectusRuntime,
) -> JobResult:
    """Prospectus at-a-glance (spec 06, ticket 05) — verdict-less ``SystemSummary``.

    Flow: validate → (fail fast without an LLM key) → IPO reference row via
    NestJS → PDF from the corpus prefix in S3 → ``ensure_parse`` (reused across
    re-runs) → route sections → LLM analysis under the cost guard → claim-check
    the rich artifact → ``SystemSummary{headline = what-to-watch, asOf}``.

    Failure classes (ADR-0007 §6): unknown IPO / missing PDF / unparseable PDF
    / no API key / rejected request / cost ceiling / still-malformed model
    output are TERMINAL; LLM timeouts, rate limits, 5xx and backend blips
    propagate as ordinary exceptions and are retried by BullMQ.
    """
    try:
        envelope = ProspectusJobEnvelope.model_validate(raw_envelope)
    except ValidationError as exc:
        raise TerminalJobError(f"Envelope failed contract validation: {exc}") from exc

    log = get_logger(__name__, correlation_id=str(envelope.correlationId))
    prospectus_id = envelope.payload.prospectusId
    # Colon form is the worker's JobResult.jobId; the BullMQ dedup id is the
    # hyphen form `prospectus-{id}`, minted TS-side (JobBus.deriveJobId).
    job_id = f"{PROSPECTUS_JOB_ID_PREFIX}{prospectus_id}"
    log.info("job.start", extra={"jobId": job_id, "jobName": JOB_ANALYZE_PROSPECTUS})

    def step(index: int) -> JobProgress:
        phase, label = _PROSPECTUS_STEPS[index]
        return _progress(index, _PROSPECTUS_TOTAL, phase, label)

    report_progress(step(0))

    # Fail fast and cleanly BEFORE any fetch/parse spend (non-retryable).
    if runtime.llm_client is None:
        raise TerminalJobError(MISSING_KEY_MESSAGE)
    client = runtime.llm_client

    # --- reference row + PDF ---------------------------------------------------
    report_progress(step(1))
    try:
        reference = IpoReference.model_validate(
            backend_client.get_ipo_reference(prospectus_id)
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise TerminalJobError(
                f"Unknown prospectus id {prospectus_id!r} (backend returned 404)"
            ) from exc
        raise  # 5xx etc. ⇒ transient, BullMQ retries
    except ValidationError as exc:
        raise TerminalJobError(
            f"IPO reference for {prospectus_id!r} is malformed: {exc}"
        ) from exc

    try:
        pdf_bytes = artifact_store.get_prospectus_pdf(reference.prospectusS3Key)
    except ValueError as exc:
        raise TerminalJobError(str(exc)) from exc
    if pdf_bytes is None:
        raise TerminalJobError(
            f"Prospectus PDF not found at {reference.prospectusS3Key!r}"
        )

    # --- parse (long on first run; reused on re-run) ---------------------------
    report_progress(step(2))
    parse_fn = runtime.parse_fn or _default_parse_fn
    t_parse = time.perf_counter()
    with _heartbeat(report_progress, lambda: step(2), runtime.heartbeat_seconds):
        try:
            parse, parsed_now = ensure_parse(
                artifact_store=artifact_store,
                prospectus_id=prospectus_id,
                pdf_bytes=pdf_bytes,
                parse_fn=parse_fn,
            )
        except TerminalJobError:
            raise
        except Exception as exc:  # deterministic on a given PDF ⇒ no retry
            raise TerminalJobError(
                f"Could not parse prospectus PDF for {prospectus_id!r}: {exc!r}"
            ) from exc
    routed = route_sections(parse)
    parse_ms = int((time.perf_counter() - t_parse) * 1000)
    log.info(
        "job.parse_ready",
        extra={
            "jobId": job_id,
            "parsedNow": parsed_now,
            "parseMs": parse_ms,
            "located": {s.value: r.located for s, r in routed.items()},
        },
    )

    # --- LLM analysis under the cost guard -------------------------------------
    tracker = CostTracker(
        model=client.model,
        ceiling_usd=runtime.cost_ceiling_usd,
        price_table=runtime.price_table,
    )
    t_analysis = time.perf_counter()
    try:
        artifact = analyze_prospectus(
            prospectus_id=prospectus_id,
            reference=reference,
            parse=parse,
            routed=routed,
            client=client,
            tracker=tracker,
            on_step=lambda s: report_progress(step(_STEP_INDEX[s])),
        )
    except CostCeilingExceeded as exc:
        raise TerminalJobError(f"Cost guard aborted the job: {exc}") from exc
    except (LLMConfigError, LLMPermanentError, MalformedModelOutput) as exc:
        raise TerminalJobError(f"LLM analysis failed permanently: {exc}") from exc
    artifact["parse"] = {"parsedNow": parsed_now, "reusedParse": not parsed_now}
    artifact["timing"] = {
        "parseMs": parse_ms,
        "analysisMs": int((time.perf_counter() - t_analysis) * 1000),
    }

    if len(artifact.get("riskFactors", {}).get("data", {}).get("themes", [])) == 0:
        log.warning(
            "prospectus.no_risks_identified",
            extra={"prospectusId": prospectus_id},
        )

    # ADR-0014 §3: strict pre-write validation against the generated contract
    # model. A malformed artifact is caught here, not in the browser; the
    # assembly above is untouched and nothing is written to S3 on failure.
    try:
        ProspectusArtifact.model_validate(artifact)
    except ValidationError as exc:
        raise TerminalJobError(
            f"Prospectus artifact failed contract validation: {exc}"
        ) from exc

    # --- claim-check + result --------------------------------------------------
    pointer = artifact_store.put_artifact(
        f"prospectus/{prospectus_id}/at-a-glance.json", artifact
    )
    report_progress(step(_PROSPECTUS_TOTAL - 1))  # persisting-artifact
    log.info(
        "job.artifact_written",
        extra={
            "jobId": job_id,
            "bucket": pointer.bucket,
            "key": pointer.key,
            "costUsd": artifact["cost"]["estimatedCostUsd"],
        },
    )

    result = JobResult(
        correlationId=envelope.correlationId,
        jobId=job_id,
        pointer=pointer,
        summary=SystemSummary(headline=artifact["headline"], asOf=envelope.asOf),
        at=_now(),
    )
    report_progress(step(_PROSPECTUS_TOTAL))  # done
    log.info("job.done", extra={"jobId": job_id})
    return result


def _default_parse_fn(pdf_bytes: bytes):  # noqa: ANN202
    """Fast PyMuPDF-based parser (prospectus-v2 ticket 01).
    
    Extracts headings from PDF native TOC + text blocks with page numbers.
    Falls back to heading recovery heuristic for un-numbered PDFs.
    """
    from .prospectus.parsing import parse_prospectus_fast

    return parse_prospectus_fast(pdf_bytes)
