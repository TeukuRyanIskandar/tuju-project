"""Runtime configuration, connection-URL-by-env (ADR-0006).

No hard-coded endpoints; everything comes from the environment so the same image
runs against LocalStack locally and AWS in prod. Local dev values live in
``.env.example`` (fake only, ADR-0009) — never a real secret in the repo.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

# Queue + job names, and the `JobResult.jobId` prefixes the worker mints
# (ADR-0007 §1, §2) — generated from packages/contracts/src/job-registry.ts
# (architecture-deepening ticket 07). Re-exported under the historical names so
# call sites keep importing from here.
#
# The BullMQ dedup id is a separate hyphen form (`prospectus-{id}`, `brief-…`)
# minted TS-side by each job family; only the colon form lives in the registry.
from .contracts_generated.job_registry import (
    JOB_ANALYZE_FUNDAMENTAL,
    JOB_ANALYZE_PROSPECTUS,
    JOB_ANALYZE_TECHNICAL,
    JOB_GENERATE_MARKET_BRIEF,
    JOB_SUMMARIZE_ANNOUNCEMENT,
    JOBS,
    QUEUE_ANALYSIS,
)

TECHNICAL_JOB_RESULT_PREFIX = JOBS[JOB_ANALYZE_TECHNICAL].result_id_prefix
FUNDAMENTAL_JOB_RESULT_PREFIX = JOBS[JOB_ANALYZE_FUNDAMENTAL].result_id_prefix
MARKET_BRIEF_JOB_ID_PREFIX = JOBS[JOB_GENERATE_MARKET_BRIEF].result_id_prefix
ANNOUNCEMENT_SUMMARY_JOB_ID_PREFIX = JOBS[JOB_SUMMARIZE_ANNOUNCEMENT].result_id_prefix
PROSPECTUS_JOB_ID_PREFIX = JOBS[JOB_ANALYZE_PROSPECTUS].result_id_prefix

# --- LLM defaults (ticket 05) ------------------------------------------------
# OpenRouter's free-tier router (prospectus-v2 T04): $0/call, ~200K context,
# picks the serving model per request (recorded per call in the cost report).
DEFAULT_LLM_MODEL = "openrouter/free"
DEFAULT_LLM_BASE_URL = "https://openrouter.ai/api/v1"
# Per-document spend ceiling (spec 06: ~$2/doc). A run that would cross it is
# aborted as a terminal failure (see tuju_ai.llm.cost).
DEFAULT_COST_CEILING_USD = 2.0
# Per-job spend ceiling for one TA/FA narration (poc-phase-a-worker ticket 06).
# Crossing it degrades the run to facts-only rather than failing it.
DEFAULT_NARRATION_COST_CEILING_USD = 0.10
# BullMQ lock duration for the worker. analyze-prospectus runs for minutes
# (sequential LLM calls; free-tier models are slow); the handler runs in a
# thread so the lock-renewal task keeps ticking (renewed every lockDuration/2),
# but a generous lock is belt-and-braces.
DEFAULT_WORKER_LOCK_DURATION_MS = 5 * 60 * 1000


@dataclass(frozen=True)
class Settings:
    """Immutable snapshot of the worker's environment configuration."""

    redis_url: str
    s3_endpoint_url: str | None
    s3_region: str
    s3_bucket: str
    s3_prefix: str
    # Base URL of the NestJS API's anonymous read surface (ADR-0004: the
    # stateless worker fetches via NestJS data APIs, never Postgres directly).
    # Only the market-brief/announcement-summary jobs use this.
    backend_api_url: str
    # --- Prospectus analysis (ticket 05). All defaulted so pre-existing
    # `Settings(...)` constructions (tests, scripts) keep working. -----------
    # Narrow read prefix for the seeded prospectus PDFs
    # (`prospectus/{fileName}`), deliberately separate from the artifacts
    # write prefix: only `ArtifactStore.get_prospectus_pdf` may read it.
    prospectus_s3_prefix: str = "prospectus"
    # OpenRouter key. ``None`` ⇒ the prospectus job fails terminally (clear,
    # non-retryable) instead of crashing the worker. NEVER log/print this.
    openrouter_api_key: str | None = field(default=None, repr=False)
    llm_model: str = DEFAULT_LLM_MODEL
    llm_base_url: str = DEFAULT_LLM_BASE_URL
    # Opt-in OpenRouter `cache_control` breakpoints on the shared prefix.
    llm_prompt_cache: bool = False
    # JSON (object) of per-model prices overriding the built-in table:
    # {"vendor/model": {"input": <USD/Mtok>, "output": <USD/Mtok>, "cachedInput": <USD/Mtok>}}
    llm_price_table_json: str | None = None
    cost_ceiling_usd: float = DEFAULT_COST_CEILING_USD
    narration_cost_ceiling_usd: float = DEFAULT_NARRATION_COST_CEILING_USD
    worker_lock_duration_ms: int = DEFAULT_WORKER_LOCK_DURATION_MS

    @staticmethod
    def from_env() -> "Settings":
        return Settings(
            # BullMQ over Redis (ADR-0001); connection URL by env (ADR-0006).
            redis_url=os.environ.get("REDIS_URL", "redis://localhost:6379"),
            # LocalStack locally (S3_ENDPOINT in .env.example); None ⇒ real AWS.
            s3_endpoint_url=os.environ.get("S3_ENDPOINT") or None,
            s3_region=os.environ.get("AWS_REGION", "ap-southeast-1"),
            s3_bucket=os.environ.get("S3_BUCKET", "tuju-artifacts"),
            # Python writes only under this scoped prefix (ADR-0004 write boundary).
            s3_prefix=os.environ.get("S3_ARTIFACTS_PREFIX", "analysis"),
            backend_api_url=os.environ.get("BACKEND_API_URL", "http://localhost:3000"),
            prospectus_s3_prefix=os.environ.get("PROSPECTUS_S3_PREFIX", "prospectus"),
            openrouter_api_key=os.environ.get("OPENROUTER_API_KEY") or None,
            llm_model=os.environ.get("LLM_MODEL") or DEFAULT_LLM_MODEL,
            llm_base_url=os.environ.get("LLM_BASE_URL") or DEFAULT_LLM_BASE_URL,
            llm_prompt_cache=os.environ.get("LLM_PROMPT_CACHE", "").lower()
            in ("1", "true", "yes"),
            llm_price_table_json=os.environ.get("LLM_PRICE_TABLE_JSON") or None,
            cost_ceiling_usd=float(
                os.environ.get("LLM_COST_CEILING_USD") or DEFAULT_COST_CEILING_USD
            ),
            narration_cost_ceiling_usd=float(
                os.environ.get("LLM_NARRATION_COST_CEILING_USD")
                or DEFAULT_NARRATION_COST_CEILING_USD
            ),
            worker_lock_duration_ms=int(
                os.environ.get("WORKER_LOCK_DURATION_MS")
                or DEFAULT_WORKER_LOCK_DURATION_MS
            ),
        )
