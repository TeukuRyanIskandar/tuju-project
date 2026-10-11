"""Unit tests for TA/FA handlers (ticket 10).

Covers: envelope validation, reference fetch, empty facts check, LLM narration
with corrective retry, grounding post-check, cost ceiling, artifact validation.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from datetime import datetime, timezone
from uuid import uuid4

import httpx
import pytest

from tuju_ai.artifacts import ArtifactStore
from tuju_ai.config import (
    JOB_ANALYZE_FUNDAMENTAL,
    JOB_ANALYZE_TECHNICAL,
    Settings,
)
from tuju_ai.contracts_generated import JobProgress, JobResult
from tuju_ai.handler import TerminalJobError
from tuju_ai.llm import Usage
from tuju_ai.llm.fake import FakeLLMClient
from tuju_ai.ta_fa_analysis import (
    _handle_fundamental_job,
    _handle_technical_job,
)

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


class FakeBackendClient:
    """Records calls and returns canned reference responses."""

    def __init__(
        self, *, analysis_reference_response: dict | None = None, **kwargs: Any
    ) -> None:
        self.analysis_reference_response = analysis_reference_response or {}
        self.calls: list[tuple[str, str]] = []

    def get_analysis_reference(self, symbol: str) -> dict:
        self.calls.append(("get_analysis_reference", symbol))
        return self.analysis_reference_response

    def get_market_indices(self) -> dict:
        raise AssertionError("Should not call")

    def get_announcement(self, announcement_id: str) -> dict:
        raise AssertionError("Should not call")

    def get_ipo_reference(self, prospectus_id: str) -> dict:
        raise AssertionError("Should not call")


def _make_ta_reference() -> dict:
    """Canned technical reference matching the spec contract."""
    return {
        "code": "1155",
        "shortName": "MAYBANK",
        "latestCloseDay": "2026-10-08",
        "asOfDatetime": "2026-10-08T18:00:00Z",
        "technical": {
            "sma": {"p20": 9.7, "p50": 9.55, "p200": 9.3},
            "rsi": {"period": 14, "value": 57.4},
            "macd": {"line": 0.02123, "signal": 0.015, "histogram": 0.00623},
            "week52": {"high": 10.45, "low": 8.32},
        },
        "technicalEvents": [
            {
                "id": "ma_cross_20_50",
                "label": "SMA-20 crossed above SMA-50",
                "fired": True,
                "values": {"sma20": 9.7, "sma50": 9.55},
                "at": "2026-10-08",
            },
            {
                "id": "ma_cross_50_200",
                "label": "SMA-50 vs SMA-200",
                "fired": False,
                "values": {"sma50": 9.55, "sma200": 9.3},
                "at": "2026-10-08",
            },
        ],
    }


def _make_fa_reference() -> dict:
    """Canned fundamental reference matching the spec contract (9 metrics)."""
    return {
        "code": "1155",
        "shortName": "MAYBANK",
        "latestCloseDay": "2026-10-08",
        "asOfDatetime": "2026-10-08T18:00:00Z",
        "fundamental": {
            "metrics": [
                {
                    "id": "trailing_pe",
                    "label": "P/E ratio (trailing)",
                    "value": 12.5,
                    "unit": "x",
                    "asOf": "2026-10-08",
                },
                {
                    "id": "dividend_yield",
                    "label": "Dividend yield",
                    "value": 3.2,
                    "unit": "%",
                    "asOf": "2026-10-08",
                },
                {
                    "id": "roe",
                    "label": "Return on Equity",
                    "value": 15.0,
                    "unit": "%",
                    "asOf": "2026-10-08",
                },
                {
                    "id": "revenue_growth_qoq",
                    "label": "Revenue growth (QoQ)",
                    "value": 5.0,
                    "unit": "%",
                    "asOf": "2026-10-08",
                },
                {
                    "id": "revenue_growth_yoy",
                    "label": "Revenue growth (YoY)",
                    "value": 20.0,
                    "unit": "%",
                    "asOf": "2026-10-08",
                },
                {
                    "id": "profit_growth_qoq",
                    "label": "Profit growth (QoQ)",
                    "value": 8.0,
                    "unit": "%",
                    "asOf": "2026-10-08",
                },
                {
                    "id": "profit_growth_yoy",
                    "label": "Profit growth (YoY)",
                    "value": 25.0,
                    "unit": "%",
                    "asOf": "2026-10-08",
                },
                {
                    "id": "debt_to_equity",
                    "label": "Debt-to-Equity",
                    "value": 0.5,
                    "unit": "x",
                    "asOf": "2026-10-08",
                },
                {
                    "id": "operating_cash_flow",
                    "label": "Operating cash flow",
                    "value": 150.0,
                    "unit": "RM m",
                    "asOf": "2026-10-08",
                },
            ]
        },
    }


def _run_ta(
    envelope: dict, backend: FakeBackendClient
) -> tuple[JobResult, list[JobProgress], FakeS3]:
    fake_s3 = FakeS3()
    store = ArtifactStore(_settings(), s3_client=fake_s3)
    progress: list[JobProgress] = []
    result = _handle_technical_job(
        envelope,
        artifact_store=store,
        report_progress=progress.append,
        backend_client=backend,
    )
    return result, progress, fake_s3


def _run_fa(
    envelope: dict, backend: FakeBackendClient
) -> tuple[JobResult, list[JobProgress], FakeS3]:
    fake_s3 = FakeS3()
    store = ArtifactStore(_settings(), s3_client=fake_s3)
    progress: list[JobProgress] = []
    result = _handle_fundamental_job(
        envelope,
        artifact_store=store,
        report_progress=progress.append,
        backend_client=backend,
    )
    return result, progress, fake_s3


def test_ta_happy_path() -> None:
    backend = FakeBackendClient(analysis_reference_response=_make_ta_reference())
    result, progress, fake_s3 = _run_ta(
        _load("technical-job-envelope.json"), backend
    )

    JobResult.model_validate(result.model_dump(mode="json"))
    assert result.jobId.startswith("technical:MAYBANK:1D:")
    assert not hasattr(result.summary, "verdict")
    assert len(result.summary.headline) > 0
    assert result.pointer.bytes > 0
    assert len(result.pointer.sha256) == 64

    assert len(fake_s3.calls) == 1
    assert fake_s3.calls[0]["Key"].startswith("analysis/technical/MAYBANK/")
    assert backend.calls == [("get_analysis_reference", "MAYBANK")]


def test_fa_happy_path() -> None:
    backend = FakeBackendClient(analysis_reference_response=_make_fa_reference())
    result, progress, fake_s3 = _run_fa(
        _load("fundamental-job-envelope.json"), backend
    )

    JobResult.model_validate(result.model_dump(mode="json"))
    assert result.jobId.startswith("fundamental:MAYBANK:quarterly:")
    assert not hasattr(result.summary, "verdict")
    assert len(result.summary.headline) > 0

    assert len(fake_s3.calls) == 1
    assert fake_s3.calls[0]["Key"].startswith("analysis/fundamental/MAYBANK/")
    assert backend.calls == [("get_analysis_reference", "MAYBANK")]


def test_ta_progress_sequence() -> None:
    backend = FakeBackendClient(analysis_reference_response=_make_ta_reference())
    result, progress, fake_s3 = _run_ta(
        _load("technical-job-envelope.json"), backend
    )

    assert [p.stepIndex for p in progress] == [0, 1, 2, 3, 4, 5]
    phases = [p.phase for p in progress]
    assert phases == [
        "queued",
        "fetching-market-data",
        "computing-indicators",
        "synthesizing-verdict",
        "persisting-artifact",
        "done",
    ]
    for p in progress:
        JobProgress.model_validate(p.model_dump(mode="json"))


def test_fa_progress_sequence() -> None:
    backend = FakeBackendClient(analysis_reference_response=_make_fa_reference())
    result, progress, fake_s3 = _run_fa(
        _load("fundamental-job-envelope.json"), backend
    )

    assert [p.stepIndex for p in progress] == [0, 1, 2, 3, 4, 5]
    phases = [p.phase for p in progress]
    assert phases == [
        "queued",
        "fetching-financials",
        "computing-metrics",
        "synthesizing-verdict",
        "persisting-artifact",
        "done",
    ]


def test_bad_ta_envelope_is_terminal() -> None:
    bad = _load("technical-job-envelope.json")
    bad["trigger"] = "not-a-trigger"
    backend = FakeBackendClient(analysis_reference_response=_make_ta_reference())
    with pytest.raises(TerminalJobError):
        _run_ta(bad, backend)


def test_bad_fa_envelope_is_terminal() -> None:
    bad = _load("fundamental-job-envelope.json")
    bad["trigger"] = "invalid"
    backend = FakeBackendClient(analysis_reference_response=_make_fa_reference())
    with pytest.raises(TerminalJobError):
        _run_fa(bad, backend)


def test_ta_404_reference_is_terminal() -> None:
    backend = FakeBackendClient(analysis_reference_response=_make_ta_reference())

    def raise_404(*args, **kwargs):
        response = httpx.Response(404)
        raise httpx.HTTPStatusError("Not found", request=None, response=response)

    backend.get_analysis_reference = raise_404
    with pytest.raises(TerminalJobError):
        _run_ta(_load("technical-job-envelope.json"), backend)


def test_fa_404_reference_is_terminal() -> None:
    backend = FakeBackendClient(analysis_reference_response=_make_fa_reference())

    def raise_404(*args, **kwargs):
        response = httpx.Response(404)
        raise httpx.HTTPStatusError("Not found", request=None, response=response)

    backend.get_analysis_reference = raise_404
    with pytest.raises(TerminalJobError):
        _run_fa(_load("fundamental-job-envelope.json"), backend)


def test_ta_empty_facts_is_terminal() -> None:
    ref = _make_ta_reference()
    ref["technical"] = {}
    backend = FakeBackendClient(analysis_reference_response=ref)
    with pytest.raises(TerminalJobError):
        _run_ta(_load("technical-job-envelope.json"), backend)


def test_fa_empty_metrics_is_terminal() -> None:
    ref = _make_fa_reference()
    ref["fundamental"]["metrics"] = []
    backend = FakeBackendClient(analysis_reference_response=ref)
    with pytest.raises(TerminalJobError):
        _run_fa(_load("fundamental-job-envelope.json"), backend)


def test_ta_malformed_llm_on_both_attempts_is_terminal(monkeypatch) -> None:
    backend = FakeBackendClient(analysis_reference_response=_make_ta_reference())

    fake_client = FakeLLMClient(garbage_first={"narrate": 2})

    def mock_get_llm():
        return fake_client

    import tuju_ai.ta_fa_analysis

    monkeypatch.setattr(tuju_ai.ta_fa_analysis, "_get_llm_client", mock_get_llm)

    with pytest.raises(TerminalJobError, match="invalid"):
        _run_ta(_load("technical-job-envelope.json"), backend)


def test_ta_grounding_double_violation_is_terminal(monkeypatch) -> None:
    backend = FakeBackendClient(analysis_reference_response=_make_ta_reference())

    class GrindingViolatingClient(FakeLLMClient):
        def complete(self, messages, **kwargs):
            resp = super().complete(messages, **kwargs)
            from tuju_ai.llm import LLMResponse
            return LLMResponse(text='{"narrative": "Should buy this stock now"}', usage=resp.usage, model=resp.model)

    fake_client = GrindingViolatingClient()

    def mock_get_llm():
        return fake_client

    import tuju_ai.ta_fa_analysis

    monkeypatch.setattr(tuju_ai.ta_fa_analysis, "_get_llm_client", mock_get_llm)

    with pytest.raises(TerminalJobError, match="Grounding"):
        _run_ta(_load("technical-job-envelope.json"), backend)


def test_ta_cost_ceiling_strips_narrative(monkeypatch) -> None:
    backend = FakeBackendClient(analysis_reference_response=_make_ta_reference())

    class ExpensiveClient(FakeLLMClient):
        def complete(self, messages, **kwargs):
            huge_usage = Usage(
                prompt_tokens=1_000_000, completion_tokens=1_000_000
            )
            resp = super().complete(messages, **kwargs)
            from tuju_ai.llm import LLMResponse
            return LLMResponse(text=resp.text, usage=huge_usage, model=resp.model)

    fake_client = ExpensiveClient()

    def mock_get_llm():
        return fake_client

    import tuju_ai.ta_fa_analysis

    monkeypatch.setattr(tuju_ai.ta_fa_analysis, "_get_llm_client", mock_get_llm)

    result, progress, fake_s3 = _run_ta(
        _load("technical-job-envelope.json"), backend
    )

    assert "facts-only: Narration stopped by cost guard." in result.summary.headline


def test_fa_pre_write_validation_failure_is_terminal(monkeypatch) -> None:
    """Test that a malformed artifact (pre-write validation) fails the job."""
    backend = FakeBackendClient(analysis_reference_response=_make_fa_reference())

    from tuju_ai.contracts_generated import FundamentalAnalysisArtifact
    from pydantic import ValidationError

    original_validate = FundamentalAnalysisArtifact.model_validate

    def bad_validate(artifact):
        raise ValidationError.from_exception_data("test", [])

    monkeypatch.setattr(
        FundamentalAnalysisArtifact, "model_validate", bad_validate
    )

    with pytest.raises(TerminalJobError, match="contract validation"):
        _run_fa(_load("fundamental-job-envelope.json"), backend)


# ---------------------------------------------------------------------------
# New tests appended below (additive only)
# ---------------------------------------------------------------------------


def test_fa_malformed_llm_on_both_attempts_is_terminal(monkeypatch) -> None:
    backend = FakeBackendClient(analysis_reference_response=_make_fa_reference())

    fake_client = FakeLLMClient(garbage_first={"narrate": 2})

    def mock_get_llm():
        return fake_client

    import tuju_ai.ta_fa_analysis

    monkeypatch.setattr(tuju_ai.ta_fa_analysis, "_get_llm_client", mock_get_llm)

    with pytest.raises(TerminalJobError, match="invalid"):
        _run_fa(_load("fundamental-job-envelope.json"), backend)


def test_fa_grounding_double_violation_is_terminal(monkeypatch) -> None:
    backend = FakeBackendClient(analysis_reference_response=_make_fa_reference())

    class BannedWordClient(FakeLLMClient):
        def complete(self, messages, **kwargs):
            resp = super().complete(messages, **kwargs)
            from tuju_ai.llm import LLMResponse
            return LLMResponse(
                text='{"narrative": "Should buy this stock now"}',
                usage=resp.usage,
                model=resp.model,
            )

    fake_client = BannedWordClient()

    def mock_get_llm():
        return fake_client

    import tuju_ai.ta_fa_analysis

    monkeypatch.setattr(tuju_ai.ta_fa_analysis, "_get_llm_client", mock_get_llm)

    with pytest.raises(TerminalJobError, match="Grounding"):
        _run_fa(_load("fundamental-job-envelope.json"), backend)


def test_fa_cost_ceiling_strips_narrative(monkeypatch) -> None:
    backend = FakeBackendClient(analysis_reference_response=_make_fa_reference())

    class ExpensiveClient(FakeLLMClient):
        def complete(self, messages, **kwargs):
            huge_usage = Usage(
                prompt_tokens=1_000_000, completion_tokens=1_000_000
            )
            resp = super().complete(messages, **kwargs)
            from tuju_ai.llm import LLMResponse
            return LLMResponse(text=resp.text, usage=huge_usage, model=resp.model)

    fake_client = ExpensiveClient()

    def mock_get_llm():
        return fake_client

    import tuju_ai.ta_fa_analysis

    monkeypatch.setattr(tuju_ai.ta_fa_analysis, "_get_llm_client", mock_get_llm)

    result, progress, fake_s3 = _run_fa(
        _load("fundamental-job-envelope.json"), backend
    )

    assert "facts-only: Narration stopped by cost guard." in result.summary.headline


def test_ta_pre_write_validation_failure_is_terminal(monkeypatch) -> None:
    backend = FakeBackendClient(analysis_reference_response=_make_ta_reference())

    from tuju_ai.contracts_generated import TechnicalAnalysisArtifact
    from pydantic import ValidationError

    original_validate = TechnicalAnalysisArtifact.model_validate

    def bad_validate(artifact):
        raise ValidationError.from_exception_data("test", [])

    monkeypatch.setattr(
        TechnicalAnalysisArtifact, "model_validate", bad_validate
    )

    with pytest.raises(TerminalJobError, match="contract validation"):
        _run_ta(_load("technical-job-envelope.json"), backend)


def test_ta_grounding_recovered_on_second_attempt(monkeypatch) -> None:
    """First narration has a ban word; corrective retry returns clean text."""
    backend = FakeBackendClient(analysis_reference_response=_make_ta_reference())

    call_count = {"n": 0}

    class FirstBadThenGoodClient(FakeLLMClient):
        def complete(self, messages, **kwargs):
            resp = super().complete(messages, **kwargs)
            call_count["n"] += 1
            from tuju_ai.llm import LLMResponse
            if call_count["n"] == 1:
                return LLMResponse(
                    text='{"narrative": "Should buy this stock now"}',
                    usage=resp.usage,
                    model=resp.model,
                )
            return resp

    fake_client = FirstBadThenGoodClient()

    def mock_get_llm():
        return fake_client

    import tuju_ai.ta_fa_analysis

    monkeypatch.setattr(tuju_ai.ta_fa_analysis, "_get_llm_client", mock_get_llm)

    result, progress, fake_s3 = _run_ta(
        _load("technical-job-envelope.json"), backend
    )

    assert not result.summary.headline.startswith("facts-only:")
    assert len(fake_s3.calls) == 1
    assert call_count["n"] == 2
