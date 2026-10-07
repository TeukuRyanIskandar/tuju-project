"""Handler-level tests for ``analyze-prospectus`` (spec 06, ticket 05).

No network, no infra: S3 is in-memory, the backend is a fake (plus one
``httpx.MockTransport`` test for the real ``HttpBackendClient``), the parse is
a counted stand-in for Docling, and the LLM is ``FakeLLMClient``.
"""

from __future__ import annotations

import hashlib
import json
import time

import httpx
import pytest

from prospectus_helpers import (
    BUCKET,
    PDF_BYTES,
    PDF_KEY,
    PROSPECTUS_ID,
    FakeBackend,
    MemoryS3,
    envelope,
    ipo_reference,
    make_parse,
    settings,
    store_with_pdf,
    stored_artifact,
)
from tuju_ai.artifacts import ArtifactStore
from tuju_ai.backend_client import HttpBackendClient
from tuju_ai.config import (
    JOB_ANALYZE_PROSPECTUS,
    PROSPECTUS_JOB_ID_PREFIX,
    Settings,
)
from tuju_ai.contracts_generated import JobProgress, JobResult
from tuju_ai.handler import TerminalJobError, handle_job
from tuju_ai.llm import FakeLLMClient, Usage
from tuju_ai.prospectus.job import (
    MISSING_KEY_MESSAGE,
    ProspectusRuntime,
    build_prospectus_runtime,
)

pytestmark = pytest.mark.unit


class CountedParse:
    def __init__(self) -> None:
        self.calls = 0

    def __call__(self, pdf_bytes: bytes):
        self.calls += 1
        return make_parse(pdf_bytes)


def _run(
    *,
    runtime: ProspectusRuntime | None,
    backend: FakeBackend | None = None,
    fake: MemoryS3 | None = None,
    env: dict | None = None,
):
    store, fake = store_with_pdf(fake)
    progress: list[JobProgress] = []
    backend = backend or FakeBackend()
    result = handle_job(
        JOB_ANALYZE_PROSPECTUS,
        env or envelope(),
        artifact_store=store,
        report_progress=progress.append,
        backend_client=backend,
        prospectus_runtime=runtime,
    )
    return result, progress, fake, backend


def _runtime(**kw) -> tuple[ProspectusRuntime, CountedParse, FakeLLMClient]:
    parse, llm = CountedParse(), FakeLLMClient()
    return ProspectusRuntime(llm_client=llm, parse_fn=parse, **kw), parse, llm


def test_happy_path_result_is_verdictless_and_contract_valid() -> None:
    runtime, parse, _llm = _runtime()
    result, progress, fake, backend = _run(runtime=runtime)

    JobResult.model_validate(result.model_dump(mode="json"))
    assert result.jobId == f"{PROSPECTUS_JOB_ID_PREFIX}{PROSPECTUS_ID}" == f"prospectus:{PROSPECTUS_ID}"
    dumped = result.model_dump(mode="json")
    assert "verdict" not in dumped["summary"]
    assert set(dumped["summary"]) == {"headline", "asOf"}
    assert backend.reference_calls == [PROSPECTUS_ID]

    # Artifact claim-checked where the pointer says, headline == what-to-watch.
    key = f"analysis/prospectus/{PROSPECTUS_ID}/at-a-glance.json"
    assert result.pointer.key == key and result.pointer.bucket == BUCKET
    artifact = stored_artifact(fake, key)
    assert hashlib.sha256(fake.objects[(BUCKET, key)]).hexdigest() == result.pointer.sha256
    assert result.summary.headline == artifact["headline"]
    assert artifact["provenance"]["source"] == "real"
    assert artifact["schemaVersion"] == "prospectus-at-a-glance-1"
    assert set(artifact["sections"]) == {
        "offer", "business", "financials", "riskFactors", "whatToWatch",
    }
    assert set(artifact["insights"]) == {"shariah", "cornerstone"}
    assert artifact["insights"]["shariah"]["status"] == "compliant"
    assert artifact["parse"]["parsedNow"] is True
    assert artifact["cost"]["estimatedCostUsd"] < 2.0
    assert parse.calls == 1


def test_progress_is_step_based_monotonic_with_known_phases() -> None:
    runtime, _p, _l = _runtime()
    _r, progress, _f, _b = _run(runtime=runtime)
    indices = [p.stepIndex for p in progress]
    assert indices == sorted(indices) and indices[0] == 0 and indices[-1] == 10
    phases = [p.phase for p in progress]
    assert phases[0] == "queued" and phases[-1] == "done"
    for needed in ("fetching-prospectus", "parsing-document", "analyzing-sections",
                   "synthesizing-watchlist", "persisting-artifact"):
        assert needed in phases
    assert {p.stepTotal for p in progress} == {10}
    for p in progress:
        JobProgress.model_validate(p.model_dump(mode="json"))


def test_rerun_reuses_the_persisted_parse() -> None:
    runtime, parse, _llm = _runtime()
    store, fake = store_with_pdf()
    for _ in range(2):
        handle_job(
            JOB_ANALYZE_PROSPECTUS,
            envelope(),
            artifact_store=store,
            report_progress=lambda _p: None,
            backend_client=FakeBackend(),
            prospectus_runtime=runtime,
        )
    assert parse.calls == 1  # second run: near-free, no re-parse
    art = stored_artifact(fake, f"analysis/prospectus/{PROSPECTUS_ID}/at-a-glance.json")
    assert art["parse"] == {"parsedNow": False, "reusedParse": True}


def test_pdf_is_read_from_the_prospectus_prefix_not_the_artifacts_prefix() -> None:
    runtime, _p, _l = _runtime()
    _r, _pr, fake, _b = _run(runtime=runtime)
    assert PDF_KEY in fake.gets
    assert any(k.startswith("analysis/prospectus/") for k in fake.gets)  # parse lookup


def test_missing_api_key_fails_terminally_before_any_work() -> None:
    backend = FakeBackend()
    runtime = ProspectusRuntime(llm_client=None, parse_fn=CountedParse())
    with pytest.raises(TerminalJobError, match="OPENROUTER_API_KEY"):
        _run(runtime=runtime, backend=backend)
    assert backend.reference_calls == []  # no backend / S3 / parse spend
    # Also the default when no runtime is wired at all:
    with pytest.raises(TerminalJobError, match="OPENROUTER_API_KEY"):
        _run(runtime=None)
    assert "OPENROUTER_API_KEY" in MISSING_KEY_MESSAGE


def test_build_runtime_without_key_does_not_raise_and_with_key_builds_client() -> None:
    assert build_prospectus_runtime(settings()).llm_client is None
    rt = build_prospectus_runtime(
        settings(openrouter_api_key="k", llm_model="google/gemini-2.5-pro")
    )
    assert rt.llm_client is not None and rt.llm_client.model == "google/gemini-2.5-pro"
    assert "k" not in repr(rt.llm_client).replace("OpenRouterClient", "")


def test_settings_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for var in ("OPENROUTER_API_KEY", "LLM_MODEL", "LLM_BASE_URL", "LLM_COST_CEILING_USD"):
        monkeypatch.delenv(var, raising=False)
    s = Settings.from_env()
    assert s.openrouter_api_key is None
    assert s.llm_model == "google/gemini-2.5-flash"
    assert s.llm_base_url == "https://openrouter.ai/api/v1"
    assert s.cost_ceiling_usd == 2.0
    monkeypatch.setenv("OPENROUTER_API_KEY", "fake-not-a-real-key")
    monkeypatch.setenv("LLM_MODEL", "google/gemini-2.5-pro")
    monkeypatch.setenv("LLM_BASE_URL", "http://localhost:1/v1")
    s = Settings.from_env()
    assert (s.openrouter_api_key, s.llm_model, s.llm_base_url) == (
        "fake-not-a-real-key", "google/gemini-2.5-pro", "http://localhost:1/v1",
    )
    assert "fake-not-a-real-key" not in repr(s)


def test_unknown_prospectus_404_is_terminal() -> None:
    req = httpx.Request("GET", "http://x/ipo/nope/reference")
    err = httpx.HTTPStatusError("nf", request=req, response=httpx.Response(404, request=req))
    runtime, _p, _l = _runtime()
    with pytest.raises(TerminalJobError, match="Unknown prospectus"):
        _run(runtime=runtime, backend=FakeBackend(err))


def test_backend_5xx_is_retryable_not_terminal() -> None:
    req = httpx.Request("GET", "http://x")
    err = httpx.HTTPStatusError("boom", request=req, response=httpx.Response(503, request=req))
    runtime, _p, _l = _runtime()
    with pytest.raises(httpx.HTTPStatusError):
        _run(runtime=runtime, backend=FakeBackend(err))


def test_malformed_reference_is_terminal() -> None:
    runtime, _p, _l = _runtime()
    with pytest.raises(TerminalJobError, match="malformed"):
        _run(runtime=runtime, backend=FakeBackend({"id": "x"}))


def test_missing_pdf_and_out_of_prefix_key_are_terminal() -> None:
    runtime, _p, _l = _runtime()
    with pytest.raises(TerminalJobError, match="not found"):
        _run(runtime=runtime, backend=FakeBackend(ipo_reference(prospectusS3Key="prospectus/absent.pdf")))
    # Narrow scope: cannot be pointed at other prefixes (artifacts, traversal).
    for bad in ("analysis/prospectus/x/parse.json", "prospectus/../analysis/x", "other/x.pdf"):
        with pytest.raises(TerminalJobError, match="refusing"):
            _run(runtime=runtime, backend=FakeBackend(ipo_reference(prospectusS3Key=bad)))


def test_unparseable_pdf_is_terminal() -> None:
    def boom(_b: bytes):
        raise RuntimeError("corrupt pdf")

    runtime = ProspectusRuntime(llm_client=FakeLLMClient(), parse_fn=boom)
    with pytest.raises(TerminalJobError, match="Could not parse"):
        _run(runtime=runtime)


def test_cost_ceiling_abort_is_terminal_and_writes_no_result_artifact() -> None:
    llm = FakeLLMClient(usage=Usage(prompt_tokens=1_000_000, completion_tokens=100_000))
    runtime = ProspectusRuntime(llm_client=llm, parse_fn=CountedParse())
    store, fake = store_with_pdf()
    with pytest.raises(TerminalJobError, match="Cost guard"):
        handle_job(
            JOB_ANALYZE_PROSPECTUS, envelope(), artifact_store=store,
            report_progress=lambda _p: None, backend_client=FakeBackend(),
            prospectus_runtime=runtime,
        )
    assert (BUCKET, f"analysis/prospectus/{PROSPECTUS_ID}/at-a-glance.json") not in fake.objects
    assert "what-to-watch" not in llm.steps


def test_persistently_malformed_llm_output_is_terminal() -> None:
    llm = FakeLLMClient(garbage_first={"financials": 5})
    runtime = ProspectusRuntime(llm_client=llm, parse_fn=CountedParse())
    with pytest.raises(TerminalJobError, match="financials"):
        _run(runtime=runtime)


def test_llm_transient_error_propagates_for_bullmq_retry() -> None:
    from tuju_ai.llm import LLMTransientError

    class Flaky(FakeLLMClient):
        def complete(self, messages, **kw):  # type: ignore[override]
            raise LLMTransientError("429 rate limited")

    runtime = ProspectusRuntime(llm_client=Flaky(), parse_fn=CountedParse())
    with pytest.raises(LLMTransientError):
        _run(runtime=runtime)


def test_llm_permanent_error_is_terminal() -> None:
    from tuju_ai.llm import LLMPermanentError

    class Rejected(FakeLLMClient):
        def complete(self, messages, **kw):  # type: ignore[override]
            raise LLMPermanentError("401 bad key")

    runtime = ProspectusRuntime(llm_client=Rejected(), parse_fn=CountedParse())
    with pytest.raises(TerminalJobError, match="permanently"):
        _run(runtime=runtime)


def test_bad_envelope_is_terminal() -> None:
    runtime, _p, _l = _runtime()
    bad = envelope()
    bad["payload"] = {}
    with pytest.raises(TerminalJobError, match="contract validation"):
        _run(runtime=runtime, env=bad)


def test_heartbeat_reemits_progress_during_a_slow_parse() -> None:
    def slow_parse(pdf_bytes: bytes):
        time.sleep(0.35)
        return make_parse(pdf_bytes)

    runtime = ProspectusRuntime(
        llm_client=FakeLLMClient(), parse_fn=slow_parse, heartbeat_seconds=0.1
    )
    _r, progress, _f, _b = _run(runtime=runtime)
    parsing = [p for p in progress if p.phase == "parsing-document"]
    assert len(parsing) >= 3  # the initial event + >=2 heartbeats
    assert {p.stepIndex for p in parsing} == {2}


def test_http_backend_client_get_ipo_reference_shape() -> None:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(200, json=ipo_reference())

    client = HttpBackendClient("http://backend:3000/", transport=httpx.MockTransport(handler))
    assert client.get_ipo_reference(PROSPECTUS_ID)["prospectusS3Key"] == PDF_KEY
    assert seen == [f"http://backend:3000/ipo/{PROSPECTUS_ID}/reference"]

    nf = HttpBackendClient("http://b", transport=httpx.MockTransport(lambda r: httpx.Response(404)))
    with pytest.raises(httpx.HTTPStatusError):
        nf.get_ipo_reference("nope")


def test_artifact_store_prospectus_read_is_narrowly_scoped() -> None:
    store, fake = store_with_pdf()
    assert store.get_prospectus_pdf(PDF_KEY) == PDF_BYTES
    assert store.get_prospectus_pdf("prospectus/none.pdf") is None
    for bad in ("prospectus/", "prospectus", "analysis/x", "prospectusx/y", "prospectus/../a"):
        with pytest.raises(ValueError):
            store.get_prospectus_pdf(bad)
    # the general reader is still confined to the artifacts prefix
    assert store.get_artifact("prospectus/Fake-Prospectus.pdf") is None
