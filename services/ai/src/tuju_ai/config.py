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


@dataclass(frozen=True)
class Settings:
    """Immutable snapshot of the worker's environment configuration."""

    redis_url: str
    s3_endpoint_url: str | None
    s3_region: str
    s3_bucket: str
    s3_prefix: str

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
        )
