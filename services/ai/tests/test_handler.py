"""Unit tests for the pure job handler (ADR-0011 unit layer — no live infra).

Covers: incoming envelope validation against the generated Pydantic model, the
step-based progress sequence (ADR-0007 §4), the S3 claim-check write (ADR-0004),
a contract-valid JobResult, and the terminal-error path for a bad envelope.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from tuju_ai.artifacts import ArtifactStore
from tuju_ai.config import (
    JOB_ANALYZE_FUNDAMENTAL,
    JOB_ANALYZE_TECHNICAL,
    Settings,
)
from tuju_ai.contracts_generated import JobProgress, JobResult
from tuju_ai.handler import TerminalJobError, handle_job

pytestmark = pytest.mark.unit

FIXTURES_DIR = (
    Path(__file__).resolve().parents[3] / "packages" / "contracts" / "fixtures"
)


class FakeS3:
    """Records ``put_object`` calls so the handler needs no live S3."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def put_object(self, **kwargs: Any) -> dict:
        self.calls.append(kwargs)
        return {"ETag": '"fake"'}


def _settings() -> Settings:
    return Settings(
        redis_url="redis://unused",
        s3_endpoint_url="http://localstack:4566",
        s3_region="ap-southeast-1",
        s3_bucket="tuju-artifacts",
        s3_prefix="analysis",
    )


def _load(name: str) -> dict:
    return json.loads((FIXTURES_DIR / name).read_text(encoding="utf-8"))


def _run(job_name: str, envelope: dict) -> tuple[JobResult, list[JobProgress], FakeS3]:
    fake = FakeS3()
    store = ArtifactStore(_settings(), s3_client=fake)
    progress: list[JobProgress] = []
    result = handle_job(
        job_name, envelope, artifact_store=store, report_progress=progress.append
    )
    return result, progress, fake


def test_technical_job_returns_valid_result() -> None:
    result, progress, fake = _run(
        JOB_ANALYZE_TECHNICAL, _load("technical-job-envelope.json")
    )

    # Result is contract-valid (re-validate the round trip).
    JobResult.model_validate(result.model_dump(mode="json"))
    assert result.jobId.startswith("ta:MAYBANK:1D:")
    assert result.summary.verdict in ("bullish", "bearish", "neutral")

    # Claim-check wrote exactly one artifact under the scoped prefix.
    assert len(fake.calls) == 1
    assert fake.calls[0]["Bucket"] == "tuju-artifacts"
    assert fake.calls[0]["Key"].startswith("analysis/ta/MAYBANK/")
    assert result.pointer.bytes > 0
    assert len(result.pointer.sha256) == 64


def test_fundamental_job_returns_valid_result() -> None:
    result, _progress, fake = _run(
        JOB_ANALYZE_FUNDAMENTAL, _load("fundamental-job-envelope.json")
    )
    assert result.jobId.startswith("fa:MAYBANK:quarterly:")
    assert result.summary.verdict in ("undervalued", "fairly-valued", "overvalued")
    assert fake.calls[0]["Key"].startswith("analysis/fa/MAYBANK/")


def test_progress_is_step_based_and_monotonic() -> None:
    _result, progress, _fake = _run(
        JOB_ANALYZE_TECHNICAL, _load("technical-job-envelope.json")
    )
    assert [p.stepIndex for p in progress] == [0, 1, 2, 3, 4, 5]
    assert progress[0].phase == "queued"
    assert progress[-1].phase == "done"
    # Every progress event validates against the generated contract model.
    for p in progress:
        JobProgress.model_validate(p.model_dump(mode="json"))


def test_bad_envelope_is_terminal() -> None:
    bad = _load("technical-job-envelope.json")
    bad["trigger"] = "not-a-trigger"
    with pytest.raises(TerminalJobError):
        _run(JOB_ANALYZE_TECHNICAL, bad)


def test_unknown_job_name_is_terminal() -> None:
    with pytest.raises(TerminalJobError):
        _run("analyze-nonsense", _load("technical-job-envelope.json"))
