"""TA/FA jobs (poc-phase-a-worker ticket 10) through ``handle_job``.

Per-job behaviour: the reference read, fact/metric assembly, the narration
outcomes (clean, corrective retry, facts-only degrade, terminal) and the
artifact. Envelope/progress/claim-check invariants live in
``test_job_pipeline.py``. The LLM is ``FakeLLMClient`` injected via
``LLMRuntime``. The serialization reproduction additionally observes validation
and storage, fixes the clock, and guards external I/O with monkeypatches.
"""

from __future__ import annotations

import hashlib
import json
import os
import socket
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any

import boto3.session
import botocore.session
import httpx
import pytest

from job_helpers import load, run
from tuju_ai.artifacts import ArtifactStore
from tuju_ai.config import JOB_ANALYZE_FUNDAMENTAL, JOB_ANALYZE_TECHNICAL
from tuju_ai.contracts_generated import (
    SCHEMA_VERSIONS,
    FundamentalAnalysisArtifact,
    JobResult,
    TechnicalAnalysisArtifact,
)
from tuju_ai.errors import TerminalJobError
from tuju_ai.llm import LLMResponse, Usage
from tuju_ai.llm.fake import FakeLLMClient

pytestmark = pytest.mark.unit


class FakeBackendClient:
    """Serves one canned analysis reference (or raises it)."""

    def __init__(self, reference: dict | Exception) -> None:
        self.reference = reference
        self.calls: list[str] = []

    def get_analysis_reference(self, symbol: str) -> dict:
        self.calls.append(symbol)
        if isinstance(self.reference, Exception):
            raise self.reference
        return self.reference


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
                    "scale": "absolute",
                    "asOf": "2026-10-08",
                },
                {
                    "id": "dividend_yield",
                    "label": "Dividend yield",
                    "value": 3.2,
                    "unit": "%",
                    "scale": "fraction",
                    "asOf": "2026-10-08",
                },
                {
                    "id": "roe",
                    "label": "Return on Equity",
                    "value": 15.0,
                    "unit": "%",
                    "scale": "fraction",
                    "asOf": "2026-10-08",
                },
                {
                    "id": "revenue_growth_qoq",
                    "label": "Revenue growth (QoQ)",
                    "value": 5.0,
                    "unit": "%",
                    "scale": "percentage_point",
                    "asOf": "2026-10-08",
                },
                {
                    "id": "revenue_growth_yoy",
                    "label": "Revenue growth (YoY)",
                    "value": 20.0,
                    "unit": "%",
                    "scale": "percentage_point",
                    "asOf": "2026-10-08",
                },
                {
                    "id": "profit_growth_qoq",
                    "label": "Profit growth (QoQ)",
                    "value": 8.0,
                    "unit": "%",
                    "scale": "percentage_point",
                    "asOf": "2026-10-08",
                },
                {
                    "id": "profit_growth_yoy",
                    "label": "Profit growth (YoY)",
                    "value": 25.0,
                    "unit": "%",
                    "scale": "percentage_point",
                    "asOf": "2026-10-08",
                },
                {
                    "id": "debt_to_equity",
                    "label": "Debt-to-Equity",
                    "value": 0.5,
                    "unit": "x",
                    "scale": "absolute",
                    "asOf": "2026-10-08",
                },
                {
                    "id": "operating_cash_flow",
                    "label": "Operating cash flow",
                    "value": 150.0,
                    "unit": "RM m",
                    "scale": "absolute",
                    "asOf": "2026-10-08",
                },
            ]
        },
    }


def _run_ta(reference: Any = None, llm: Any = True, envelope: dict | None = None):
    backend = FakeBackendClient(_make_ta_reference() if reference is None else reference)
    result, progress, s3 = run(
        JOB_ANALYZE_TECHNICAL,
        envelope or load("technical-job-envelope.json"),
        backend=backend,
        llm=llm,
    )
    return result, progress, s3, backend


def _run_fa(reference: Any = None, llm: Any = True, envelope: dict | None = None):
    backend = FakeBackendClient(_make_fa_reference() if reference is None else reference)
    result, progress, s3 = run(
        JOB_ANALYZE_FUNDAMENTAL,
        envelope or load("fundamental-job-envelope.json"),
        backend=backend,
        llm=llm,
    )
    return result, progress, s3, backend


def _not_found() -> httpx.HTTPStatusError:
    req = httpx.Request("GET", "http://backend/stocks/X/analysis/reference")
    return httpx.HTTPStatusError("nf", request=req, response=httpx.Response(404, request=req))


# --- happy paths --------------------------------------------------------------


def test_ta_happy_path() -> None:
    result, progress, s3, backend = _run_ta()

    JobResult.model_validate(result.model_dump(mode="json"))
    assert result.jobId == "technical:MAYBANK:1D:2026-09-29T04"
    assert result.summary.headline == "SMA-20 crossed above SMA-50"  # first fired event
    assert result.pointer.key == "analysis/technical/MAYBANK/2026-09-29T04.json"
    assert backend.calls == ["MAYBANK"]
    assert progress[1].label == "Fetching data for MAYBANK"

    artifact = s3.artifact(result.pointer.key)
    TechnicalAnalysisArtifact.model_validate(artifact)
    assert artifact["schemaVersion"] == "technical-analysis-1"
    assert artifact["facts"]["rsi"] == {"period": 14, "value": 57.4}
    assert [e["id"] for e in artifact["events"]] == ["ma_cross_20_50", "ma_cross_50_200"]
    assert artifact["narrative"]["text"] == "Fake: price above all SMAs with RSI at mid-band."
    assert artifact["provenance"]["model"] == "fake/deterministic"
    assert artifact["cost"]["calls"] == 1 and artifact["cost"]["ceilingUsd"] == 0.10


def test_fa_happy_path() -> None:
    result, progress, s3, backend = _run_fa()

    JobResult.model_validate(result.model_dump(mode="json"))
    assert result.jobId.startswith("fundamental:MAYBANK:quarterly:")
    assert result.summary.headline == "P/E ratio (trailing) 12.5x"  # first non-null metric
    assert result.pointer.key.startswith("analysis/fundamental/MAYBANK/")
    assert backend.calls == ["MAYBANK"]
    assert progress[1].label == "Fetching financials for MAYBANK"

    artifact = s3.artifact(result.pointer.key)
    FundamentalAnalysisArtifact.model_validate(artifact)
    assert artifact["schemaVersion"] == SCHEMA_VERSIONS["fundamental"]
    assert len(artifact["metrics"]) == 9
    # The producer declares scale per metric; the worker must pass it through.
    assert [m["scale"] for m in artifact["metrics"]] == [
        "absolute",  # trailing_pe (x)
        "fraction",  # dividend_yield (%)
        "fraction",  # roe (%)
        "percentage_point",  # revenue_growth_qoq (%)
        "percentage_point",  # revenue_growth_yoy (%)
        "percentage_point",  # profit_growth_qoq (%)
        "percentage_point",  # profit_growth_yoy (%)
        "absolute",  # debt_to_equity (x)
        "absolute",  # operating_cash_flow (RM m)
    ]


def test_ta_fa_captured_timestamp_bytes_against_source_ts_contracts(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    """Exact final bytes from real producers/validation/storage, with offline fakes.

    The optional Vitest handoff consumes BOTH exact S3 bodies, never golden
    fixtures or repaired artifacts. Only its in-memory controls change timestamps.
    Installed Node/Vitest dependencies are required; nothing is downloaded.
    """
    def forbidden(*args, **kwargs):
        raise AssertionError("offline reproduction attempted network/cloud/credentials")

    monkeypatch.setattr(socket.socket, "connect", forbidden)
    monkeypatch.setattr(socket.socket, "connect_ex", forbidden)
    monkeypatch.setattr(socket, "getaddrinfo", forbidden)
    monkeypatch.setattr(httpx.Client, "send", forbidden)
    monkeypatch.setattr(httpx.AsyncClient, "send", forbidden)
    monkeypatch.setattr(boto3, "client", forbidden)
    monkeypatch.setattr(boto3.session.Session, "client", forbidden)
    monkeypatch.setattr(botocore.session.Session, "create_client", forbidden)
    monkeypatch.setattr(botocore.session.Session, "get_credentials", forbidden)
    monkeypatch.setattr(boto3.session.Session, "get_credentials", forbidden)

    as_of = datetime.fromisoformat("2026-10-08T18:02:03.123456+08:00")
    generated = datetime.fromisoformat("2026-10-08T10:04:05.654321+00:00")
    monkeypatch.setattr("tuju_ai.ta_fa_analysis.now", lambda: generated)
    monkeypatch.setattr("tuju_ai.jobs.pipeline.now", lambda: generated)

    for kind, runner, contract in [
        ("technical", _run_ta, TechnicalAnalysisArtifact),
        ("fundamental", _run_fa, FundamentalAnalysisArtifact),
    ]:
        envelope = load(f"{kind}-job-envelope.json")
        envelope["asOf"] = as_of.isoformat()
        validated: list[dict] = []
        original_validate = contract.model_validate
        original_put = ArtifactStore.put_artifact

        def validate(artifact, **kwargs):
            assert artifact["asOf"] == as_of
            assert isinstance(artifact["asOf"], datetime)
            assert artifact["provenance"]["generatedAt"] is generated
            parsed = original_validate(artifact, **kwargs)
            validated.append(artifact)
            return parsed

        def put(store, suffix, artifact):
            # Observe without replacing the real producer, validator or serializer.
            assert len(validated) == 1 and validated[0] is not artifact
            assert validated[0]["asOf"] == as_of
            assert isinstance(validated[0]["asOf"], datetime)
            assert validated[0]["provenance"]["generatedAt"] is generated
            assert isinstance(artifact["asOf"], str)
            return original_put(store, suffix, artifact)

        llm = FakeLLMClient()
        reference = None
        if kind == "fundamental":
            reference = _make_fa_reference()
            reference["fundamental"]["metrics"][-1]["value"] = None
        with monkeypatch.context() as observe:
            observe.setattr(contract, "model_validate", validate)
            observe.setattr(ArtifactStore, "put_artifact", put)
            result, progress, s3, backend = runner(
                envelope=envelope, llm=llm, reference=reference,
            )

        assert backend.calls == ["MAYBANK"]
        assert llm.steps == ["narrate"]
        assert progress[-1].phase == "done"
        assert len(s3.calls) == 1
        call = s3.calls[0]
        body = call["Body"]
        assert isinstance(body, bytes)
        assert body is s3.objects[(call["Bucket"], call["Key"])]
        assert call["Key"] == f"analysis/{kind}/MAYBANK/2026-10-08T10.json"
        assert call["Bucket"] == result.pointer.bucket == "tuju-artifacts"
        assert call["Key"] == result.pointer.key
        assert call["ContentType"] == result.pointer.contentType == "application/json"
        assert result.pointer.bytes == len(body)
        assert result.pointer.sha256 == hashlib.sha256(body).hexdigest()
        captured = json.loads(body)
        assert captured["asOf"] == "2026-10-08T18:02:03.123456+08:00"
        assert captured["provenance"]["generatedAt"] == "2026-10-08T10:04:05.654321Z"
        if kind == "fundamental":
            assert captured["metrics"][-1]["value"] is None
        (tmp_path / f"{kind}.json").write_bytes(body)

    contracts = Path(__file__).resolve().parents[3] / "packages" / "contracts"
    vitest = contracts / "node_modules" / "vitest" / "vitest.mjs"
    assert vitest.is_file(), "installed contracts Vitest required (no auto-install)"
    # A direct installed runner avoids package-manager sync/downloads. No provider
    # or credential environment is handed to the source-schema-only subprocess.
    env = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR") if key in os.environ}
    env["TUJU_TA_FA_CAPTURE_DIR"] = str(tmp_path)
    try:
        checked = subprocess.run(
            ["node", str(vitest), "run", "test/fixtures.test.ts",
             "-t", "captured TA/FA timestamp serialization", "--maxWorkers=1", "--minWorkers=1"],
            cwd=contracts, env=env, capture_output=True, text=True, timeout=60,
        )
    finally:
        for kind in ("technical", "fundamental"):
            (tmp_path / f"{kind}.json").unlink()
    assert checked.returncode == 0, checked.stdout + checked.stderr
    # Keep actual cross-language evidence visible with pytest -rP / -s.
    print(checked.stdout)


def test_ta_without_fired_events_falls_back_to_the_unavailable_headline() -> None:
    ref = _make_ta_reference()
    ref["technicalEvents"] = []
    result, *_ = _run_ta(ref)
    assert result.summary.headline == "Data unavailable for analysis"


# --- terminal inputs --------------------------------------------------------------


@pytest.mark.parametrize("runner", [_run_ta, _run_fa])
def test_unknown_symbol_404_is_terminal(runner) -> None:
    with pytest.raises(TerminalJobError, match="Unknown symbol 'MAYBANK'"):
        runner(_not_found())


def test_ta_empty_facts_is_terminal() -> None:
    ref = _make_ta_reference()
    ref["technical"] = {}
    with pytest.raises(TerminalJobError, match="technical facts"):
        _run_ta(ref)


def test_fa_empty_metrics_is_terminal() -> None:
    ref = _make_fa_reference()
    ref["fundamental"]["metrics"] = []
    with pytest.raises(TerminalJobError, match="fundamental metrics"):
        _run_fa(ref)


def test_fa_wrong_metric_count_is_terminal() -> None:
    ref = _make_fa_reference()
    ref["fundamental"]["metrics"].pop()
    with pytest.raises(TerminalJobError, match="Expected 9"):
        _run_fa(ref)


def test_fa_annual_period_is_terminal_before_any_read() -> None:
    envelope = load("fundamental-job-envelope.json")
    envelope["payload"]["period"] = "annual"
    with pytest.raises(TerminalJobError, match="Annual"):
        _run_fa(RuntimeError("must not be read"), envelope=envelope)


@pytest.mark.parametrize("runner", [_run_ta, _run_fa])
def test_missing_llm_key_is_terminal_before_any_read(runner) -> None:
    with pytest.raises(TerminalJobError, match="OPENROUTER_API_KEY"):
        runner(RuntimeError("must not be read"), llm=None)


# --- narration outcomes (FakeLLMClient injected via LLMRuntime) -------------


class ScriptedNarration(FakeLLMClient):
    """Replies with the given narratives in order, then the canned one."""

    def __init__(self, *narratives: str, **kw) -> None:
        super().__init__(**kw)
        self._script = list(narratives)

    def complete(self, messages, **kwargs):  # type: ignore[override]
        resp = super().complete(messages, **kwargs)
        if not self._script:
            return resp
        text = json.dumps({"narrative": self._script.pop(0)})
        return LLMResponse(text=text, usage=resp.usage, model=resp.model)


def _expensive() -> FakeLLMClient:
    return FakeLLMClient(
        model="google/gemini-2.5-flash",
        usage=Usage(prompt_tokens=1_000_000, completion_tokens=1_000_000),
    )


@pytest.mark.parametrize("runner", [_run_ta, _run_fa])
def test_malformed_narration_on_both_attempts_is_terminal(runner) -> None:
    llm = FakeLLMClient(model="google/gemini-2.5-flash", garbage_first={"narrate": 2})
    with pytest.raises(TerminalJobError, match="invalid"):
        runner(llm=llm)
    assert llm.steps == ["narrate", "narrate"]  # one corrective retry, no more


@pytest.mark.parametrize("runner", [_run_ta, _run_fa])
def test_grounding_violation_on_both_attempts_degrades_to_facts_only(runner) -> None:
    llm = ScriptedNarration(
        "Investors should buy this stock now",
        "Price sits 42 above the average",  # 42 is not in the facts
        model="google/gemini-2.5-flash",
    )
    result, _progress, s3, _b = runner(llm=llm)

    assert result.summary.headline == "facts-only: Grounding check failed."
    artifact = s3.artifact(result.pointer.key)
    assert artifact["narrative"]["text"] == "Narrative withheld: failed the grounding check."
    assert artifact["cost"]["calls"] == 2  # real usage is still reported


@pytest.mark.parametrize("runner", [_run_ta, _run_fa])
def test_cost_ceiling_degrades_to_facts_only(runner) -> None:
    result, _progress, s3, _b = runner(llm=_expensive())
    assert result.summary.headline == "facts-only: Narration stopped by cost guard."
    artifact = s3.artifact(result.pointer.key)
    assert artifact["narrative"]["text"] == "Narrative withheld: narration stopped by cost guard."
    assert artifact["cost"]["ceilingUsd"] == 0.10  # the narration ceiling


def test_grounding_recovered_on_second_attempt() -> None:
    """First narration has a ban word; corrective retry returns clean text."""
    llm = ScriptedNarration("Should buy this stock now")
    result, _progress, s3, _b = _run_ta(llm=llm)

    assert result.summary.headline == "SMA-20 crossed above SMA-50"
    assert len(s3.calls) == 1
    assert llm.steps == ["narrate", "narrate"]
    # the retry fed the rejection back to the model
    assert "banned term 'buy'" in llm.calls[1][-1].content
    assert s3.artifact(result.pointer.key)["cost"]["calls"] == 2
