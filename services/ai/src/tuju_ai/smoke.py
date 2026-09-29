"""Offline smoke entrypoint (`uv run tuju-ai-smoke`).

Exercises the full handler path — envelope validation → LangGraph stub →
claim-check → validated JobResult — against an in-memory fake S3, with NO live
Redis or S3 (ADR-0006 disposable, ADR-0011 unit layer needs no infra). Proves the
service boots and its wiring is sound.
"""

from __future__ import annotations

from typing import Any

from .artifacts import ArtifactStore
from .config import JOB_ANALYZE_TECHNICAL, Settings
from .contracts_generated import JobProgress
from .handler import handle_job
from .logging_config import configure_logging, get_logger


class InMemoryS3:
    """Minimal ``put_object`` stand-in so the smoke path needs no LocalStack."""

    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    def put_object(self, *, Bucket: str, Key: str, Body: bytes, **_: Any) -> dict:
        self.objects[(Bucket, Key)] = Body
        return {"ETag": '"stub"'}


# A fixture envelope identical in shape to packages/contracts fixtures.
_SMOKE_ENVELOPE = {
    "correlationId": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    "requestedBy": "smoke",
    "trigger": "user",
    "asOf": "2026-09-29T04:00:00Z",
    "payload": {"symbol": "MAYBANK", "timeframe": "1D", "indicators": ["SMA200"]},
}


def main() -> None:
    configure_logging()
    log = get_logger(__name__)
    settings = Settings.from_env()
    store = ArtifactStore(settings, s3_client=InMemoryS3())

    progress: list[JobProgress] = []
    log.info("smoke.start")
    result = handle_job(
        JOB_ANALYZE_TECHNICAL,
        _SMOKE_ENVELOPE,
        artifact_store=store,
        report_progress=progress.append,
    )
    log.info(
        "smoke.ok",
        extra={
            "jobId": result.jobId,
            "verdict": result.summary.verdict,
            "pointerKey": result.pointer.key,
            "progressSteps": len(progress),
        },
    )


if __name__ == "__main__":  # pragma: no cover
    main()
