"""Runtime configuration, connection-URL-by-env (ADR-0006).

No hard-coded endpoints; everything comes from the environment so the same image
runs against LocalStack locally and AWS in prod. Local dev values live in
``.env.example`` (fake only, ADR-0009) — never a real secret in the repo.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

# Queue + job names — mirror packages/contracts/src/enums.ts (ADR-0007 §1).
QUEUE_ANALYSIS = "analysis"
JOB_ANALYZE_TECHNICAL = "analyze-technical"
JOB_ANALYZE_FUNDAMENTAL = "analyze-fundamental"
# Spec-06 system-triggered showcase jobs (free-tier-ai-showcase, tickets 02/03).
JOB_GENERATE_MARKET_BRIEF = "generate-market-brief"
JOB_SUMMARIZE_ANNOUNCEMENT = "summarize-announcement"

# `JobResult.jobId` prefixes the worker mints for the two showcase jobs
# (ADR-0007 §2) — NOT the BullMQ dedup job id (`JobBus.deriveJobId`, TS side);
# a distinct, independently-computed identity embedded in the wire `JobResult`
# itself, which `MarketBriefStore`/`AnnouncementSummaryStore` parse back out
# to recover their domain key (mirror these exactly if they ever change).
MARKET_BRIEF_JOB_ID_PREFIX = "brief:"
ANNOUNCEMENT_SUMMARY_JOB_ID_PREFIX = "ann:"


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
        )
