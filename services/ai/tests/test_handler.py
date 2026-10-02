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
    JOB_GENERATE_MARKET_BRIEF,
    JOB_SUMMARIZE_ANNOUNCEMENT,
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
        backend_api_url="http://backend-unused",
    )


def _load(name: str) -> dict:
    return json.loads((FIXTURES_DIR / name).read_text(encoding="utf-8"))


class _UnusedBackendClient:
    """Stand-in `BackendClient` for TA/FA tests, which never call it."""

    def get_market_indices(self) -> dict:
        raise AssertionError("TA/FA jobs must not call the backend client")

    def get_announcement(self, announcement_id: str) -> dict:
        raise AssertionError("TA/FA jobs must not call the backend client")


def _run(job_name: str, envelope: dict) -> tuple[JobResult, list[JobProgress], FakeS3]:
    fake = FakeS3()
    store = ArtifactStore(_settings(), s3_client=fake)
    progress: list[JobProgress] = []
    result = handle_job(
        job_name,
        envelope,
        artifact_store=store,
        report_progress=progress.append,
        backend_client=_UnusedBackendClient(),
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


# --- Spec-06 showcase jobs (free-tier-ai-showcase, tickets 02/03) -----------


class FakeBackendClient:
    """Records calls and returns canned NestJS-shaped responses."""

    def __init__(
        self,
        *,
        indices_response: dict | None = None,
        announcement_response: dict | None = None,
    ) -> None:
        self.indices_response = indices_response or {"indices": []}
        self.announcement_response = announcement_response or {}
        self.market_indices_calls = 0
        self.announcement_calls: list[str] = []

    def get_market_indices(self) -> dict:
        self.market_indices_calls += 1
        return self.indices_response

    def get_announcement(self, announcement_id: str) -> dict:
        self.announcement_calls.append(announcement_id)
        return self.announcement_response


def _run_system_job(
    job_name: str, envelope: dict, backend_client: FakeBackendClient
) -> tuple[JobResult, list[JobProgress], FakeS3]:
    fake = FakeS3()
    store = ArtifactStore(_settings(), s3_client=fake)
    progress: list[JobProgress] = []
    result = handle_job(
        job_name,
        envelope,
        artifact_store=store,
        report_progress=progress.append,
        backend_client=backend_client,
    )
    return result, progress, fake


def test_market_brief_job_returns_verdict_less_summary() -> None:
    backend = FakeBackendClient(
        indices_response={
            "indices": [
                {
                    "id": "idx-1",
                    "kind": "headline",
                    "name": "FBM KLCI (demo)",
                    "sectorName": None,
                    "level": "1500.00",
                    "pctChange": 1.5,
                    "provenance": "synthetic",
                }
            ]
        }
    )
    result, progress, fake = _run_system_job(
        JOB_GENERATE_MARKET_BRIEF,
        _load("market-brief-job-envelope.json"),
        backend,
    )

    JobResult.model_validate(result.model_dump(mode="json"))
    assert result.jobId == "brief:2026-09-29"
    assert not hasattr(result.summary, "verdict")
    assert "illustrative" in result.summary.headline.lower() or "FBM KLCI" in result.summary.headline
    assert backend.market_indices_calls == 1
    assert fake.calls[0]["Key"].startswith("analysis/brief/")


def test_market_brief_job_id_is_stable_for_the_same_day() -> None:
    envelope = _load("market-brief-job-envelope.json")
    backend = FakeBackendClient()
    result_a, _progress_a, _fake_a = _run_system_job(
        JOB_GENERATE_MARKET_BRIEF, envelope, backend
    )
    # A different time of day, same calendar day — same content-derived jobId
    # (ADR-0007 §2): re-enqueuing the same day collapses to one job.
    later_same_day = dict(envelope, asOf="2026-09-29T23:59:00Z")
    result_b, _progress_b, _fake_b = _run_system_job(
        JOB_GENERATE_MARKET_BRIEF, later_same_day, backend
    )
    assert result_a.jobId == result_b.jobId == "brief:2026-09-29"


def test_announcement_summary_job_returns_verdict_less_summary() -> None:
    backend = FakeBackendClient(
        announcement_response={
            "companyName": "Malayan Banking Berhad",
            "category": "FINANCIAL_RESULTS",
            "title": "Q3 FY2026 Financial Results",
        }
    )
    envelope = _load("announcement-summary-job-envelope.json")
    result, _progress, fake = _run_system_job(
        JOB_SUMMARIZE_ANNOUNCEMENT, envelope, backend
    )

    JobResult.model_validate(result.model_dump(mode="json"))
    announcement_id = envelope["payload"]["announcementId"]
    assert result.jobId == f"ann:{announcement_id}"
    assert not hasattr(result.summary, "verdict")
    assert "Malayan Banking Berhad" in result.summary.headline
    assert backend.announcement_calls == [announcement_id]
    assert fake.calls[0]["Key"].startswith(f"analysis/announcement/{announcement_id}/")


def test_announcement_summary_job_id_ignores_asof() -> None:
    backend = FakeBackendClient()
    envelope = _load("announcement-summary-job-envelope.json")
    result_a, _pa, _fa = _run_system_job(
        JOB_SUMMARIZE_ANNOUNCEMENT, envelope, backend
    )
    later = dict(envelope, asOf="2026-10-05T00:00:00Z")
    result_b, _pb, _fb = _run_system_job(
        JOB_SUMMARIZE_ANNOUNCEMENT, later, backend
    )
    # One job per announcement regardless of asOf — a legitimate re-summarize
    # overwrites the same Postgres row (ticket 03 acceptance criteria).
    assert result_a.jobId == result_b.jobId


def test_market_brief_bad_envelope_is_terminal() -> None:
    bad = _load("market-brief-job-envelope.json")
    bad["trigger"] = "not-a-trigger"
    with pytest.raises(TerminalJobError):
        _run_system_job(JOB_GENERATE_MARKET_BRIEF, bad, FakeBackendClient())


def test_announcement_summary_bad_envelope_is_terminal() -> None:
    bad = _load("announcement-summary-job-envelope.json")
    bad["payload"] = {"announcementId": "not-a-uuid"}
    with pytest.raises(TerminalJobError):
        _run_system_job(JOB_SUMMARIZE_ANNOUNCEMENT, bad, FakeBackendClient())
