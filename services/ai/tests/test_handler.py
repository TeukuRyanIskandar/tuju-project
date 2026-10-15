"""Showcase jobs through ``handle_job`` (spec 06, tickets 02/03; ADR-0011 unit layer).

Per-job behaviour only — what each ``work()`` produces. Envelope validation,
progress, the claim-check and the result shape are pipeline invariants
(``test_job_pipeline.py``).
"""

from __future__ import annotations

import pytest

from job_helpers import load, run
from tuju_ai.config import JOB_GENERATE_MARKET_BRIEF, JOB_SUMMARIZE_ANNOUNCEMENT

pytestmark = pytest.mark.unit


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


def test_market_brief_job_narrates_the_index_panel() -> None:
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
    result, progress, s3 = run(
        JOB_GENERATE_MARKET_BRIEF, load("market-brief-job-envelope.json"), backend=backend
    )

    assert result.jobId == "brief:2026-09-29"
    assert "FBM KLCI" in result.summary.headline
    assert backend.market_indices_calls == 1
    artifact = s3.artifact("analysis/brief/2026-09-29.json")
    assert artifact == {
        "schemaVersion": "brief-1",
        "headline": result.summary.headline,
        "lines": artifact["lines"],
        "illustrative": True,
    }
    assert [p.label for p in progress][1:3] == ["Fetching index data", "Drafting market brief"]


def test_market_brief_job_id_is_stable_for_the_same_day() -> None:
    envelope = load("market-brief-job-envelope.json")
    result_a, *_ = run(JOB_GENERATE_MARKET_BRIEF, envelope, backend=FakeBackendClient())
    # A different time of day, same calendar day — same content-derived jobId
    # (ADR-0007 §2): re-enqueuing the same day collapses to one job.
    later_same_day = dict(envelope, asOf="2026-09-29T23:59:00Z")
    result_b, *_ = run(JOB_GENERATE_MARKET_BRIEF, later_same_day, backend=FakeBackendClient())
    assert result_a.jobId == result_b.jobId == "brief:2026-09-29"


def test_announcement_summary_job_summarizes_the_announcement() -> None:
    backend = FakeBackendClient(
        announcement_response={
            "companyName": "Malayan Banking Berhad",
            "category": "FINANCIAL_RESULTS",
            "title": "Q3 FY2026 Financial Results",
        }
    )
    envelope = load("announcement-summary-job-envelope.json")
    result, _progress, s3 = run(JOB_SUMMARIZE_ANNOUNCEMENT, envelope, backend=backend)

    announcement_id = envelope["payload"]["announcementId"]
    assert result.jobId == f"ann:{announcement_id}"
    assert "Malayan Banking Berhad" in result.summary.headline
    assert backend.announcement_calls == [announcement_id]
    assert result.pointer.key.startswith(f"analysis/announcement/{announcement_id}/")
    artifact = s3.artifact(result.pointer.key)
    assert artifact["schemaVersion"] == "announcement-summary-1"
    assert artifact["announcementId"] == announcement_id
    assert artifact["category"] == "FINANCIAL_RESULTS"


def test_announcement_summary_job_id_ignores_asof() -> None:
    envelope = load("announcement-summary-job-envelope.json")
    result_a, *_ = run(JOB_SUMMARIZE_ANNOUNCEMENT, envelope, backend=FakeBackendClient())
    later = dict(envelope, asOf="2026-10-05T00:00:00Z")
    result_b, *_ = run(JOB_SUMMARIZE_ANNOUNCEMENT, later, backend=FakeBackendClient())
    # One job per announcement regardless of asOf — a legitimate re-summarize
    # overwrites the same Postgres row (ticket 03 acceptance criteria).
    assert result_a.jobId == result_b.jobId
