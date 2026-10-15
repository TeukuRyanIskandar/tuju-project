"""The ``analyze-prospectus`` job (spec 06, ticket 05) — verdict-less ``SystemSummary``.

``work()``: (fail fast without an LLM key) → IPO reference row via NestJS →
PDF from the corpus prefix in S3 → :func:`~.analysis.analyze` (parse reuse,
routing, the LLM steps under the cost guard) → the at-a-glance artifact, whose
headline is the what-to-watch headline.

Failure classes (ADR-0007 §6): unknown IPO / malformed reference / missing PDF
/ unparseable PDF / no API key / rejected request / cost ceiling /
still-malformed model output are TERMINAL; LLM timeouts, rate limits, 5xx and
backend blips propagate and BullMQ retries them.
"""

from __future__ import annotations

from pydantic import ValidationError

from ..config import JOB_ANALYZE_PROSPECTUS
from ..contracts_generated import ProspectusArtifact, ProspectusJobEnvelope
from ..errors import TerminalJobError
from ..jobs.pipeline import JobContext, JobDefinition, JobOutput
from .analysis import PROGRESS_STEPS, AnalysisDeps, analyze
from .analysis_models import IpoReference
from .models import ProspectusParse


def default_parse_fn(pdf_bytes: bytes) -> ProspectusParse:
    """Fast PyMuPDF parse (prospectus-v2 ticket 01): headings from the PDF's
    native TOC (or typography), text blocks with page numbers. Lazy import."""
    from .parsing import parse_prospectus_fast

    return parse_prospectus_fast(pdf_bytes)


def _work(envelope: ProspectusJobEnvelope, ctx: JobContext) -> JobOutput:
    # Fail fast and cleanly BEFORE any fetch/parse spend (non-retryable).
    session = ctx.llm_session()
    prospectus_id = envelope.payload.prospectusId
    store = ctx.deps.artifact_store

    # --- reference row + PDF ---------------------------------------------------
    ctx.advance()
    raw_reference = ctx.read(
        lambda: ctx.deps.backend.get_ipo_reference(prospectus_id),
        unknown=f"prospectus id {prospectus_id!r}",
    )
    try:
        reference = IpoReference.model_validate(raw_reference)
    except ValidationError as exc:
        raise TerminalJobError(
            f"IPO reference for {prospectus_id!r} is malformed: {exc}"
        ) from exc
    try:
        pdf_bytes = store.get_prospectus_pdf(reference.prospectusS3Key)
    except ValueError as exc:
        raise TerminalJobError(str(exc)) from exc
    if pdf_bytes is None:
        raise TerminalJobError(
            f"Prospectus PDF not found at {reference.prospectusS3Key!r}"
        )

    # --- parse (reused across re-runs) → route → LLM steps ---------------------
    artifact = analyze(
        prospectus_id,
        reference,
        pdf_bytes,
        AnalysisDeps(
            llm=session,
            parse_fn=ctx.deps.parse_fn or default_parse_fn,
            parse_cache=store,
        ),
        progress=ctx,
    )
    ctx.log.info(
        "job.analysis_ready",
        extra={
            "jobId": ctx.job_id,
            **artifact["parse"],
            **artifact["timing"],
            "located": {
                k: v["routing"]["located"]
                for group in ("sections", "insights")
                for k, v in artifact[group].items()
                if "routing" in v
            },
        },
    )
    return JobOutput(
        artifact_key=f"prospectus/{prospectus_id}/at-a-glance.json",
        artifact=artifact,
        headline=artifact["headline"],
    )


# Colon form is the worker's JobResult.jobId; the BullMQ dedup id is the
# hyphen form `prospectus-{id}`, minted TS-side by the job family.
PROSPECTUS_JOB = JobDefinition(
    name=JOB_ANALYZE_PROSPECTUS,
    envelope=ProspectusJobEnvelope,
    result_key=lambda e: e.payload.prospectusId,
    work_steps=[("fetching-prospectus", "Fetching prospectus"), *PROGRESS_STEPS],
    work=_work,
    artifact_contract=ProspectusArtifact,
)
