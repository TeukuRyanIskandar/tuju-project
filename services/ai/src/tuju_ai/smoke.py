"""Offline smoke entrypoint (`uv run tuju-ai-smoke`).

Exercises the full handler path for ``analyze-technical`` — envelope
validation → reference read → narration → claim-check → validated JobResult —
against an in-memory fake S3, a canned backend and the deterministic
``FakeLLMClient``, with NO live Redis, S3, backend or LLM (ADR-0006 disposable,
ADR-0011 unit layer needs no infra). Proves the service boots and its wiring is
sound.
"""

from __future__ import annotations

from typing import Any

from .artifacts import ArtifactStore
from .config import JOB_ANALYZE_TECHNICAL, Settings
from .contracts_generated import JobProgress
from .handler import handle_job
from .jobs.pipeline import JobDeps
from .llm import FakeLLMClient, LLMRuntime
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


class CannedBackend:
    """Serves one TA analysis reference row; no other read is used."""

    def get_analysis_reference(self, symbol: str) -> dict:
        return {
            "code": "1155",
            "shortName": symbol,
            "technical": {
                "sma": {"p20": 9.7, "p50": 9.55, "p200": 9.3},
                "rsi": {"period": 14, "value": 57.4},
                "macd": {"line": 0.021, "signal": 0.015, "histogram": 0.006},
                "week52": {"high": 10.45, "low": 8.32},
            },
            "technicalEvents": [
                {
                    "id": "ma_cross_20_50",
                    "label": "SMA-20 crossed above SMA-50",
                    "fired": True,
                    "values": {"sma20": 9.7, "sma50": 9.55},
                    "at": "2026-09-29",
                }
            ],
        }

    def get_market_indices(self) -> dict:  # pragma: no cover - unused
        raise AssertionError("smoke only runs analyze-technical")

    def get_announcement(self, announcement_id: str) -> dict:  # pragma: no cover
        raise AssertionError("smoke only runs analyze-technical")

    def get_ipo_reference(self, prospectus_id: str) -> dict:  # pragma: no cover
        raise AssertionError("smoke only runs analyze-technical")


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
        deps=JobDeps(
            artifact_store=store,
            backend=CannedBackend(),
            llm=LLMRuntime(client=FakeLLMClient()),
        ),
        report_progress=progress.append,
    )
    log.info(
        "smoke.ok",
        extra={
            "jobId": result.jobId,
            "headline": result.summary.headline,
            "pointerKey": result.pointer.key,
            "progressSteps": len(progress),
        },
    )


if __name__ == "__main__":  # pragma: no cover
    main()
