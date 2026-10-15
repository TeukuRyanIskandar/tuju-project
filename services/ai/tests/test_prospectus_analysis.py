"""Unit tests for the prospectus at-a-glance analysis (spec 06 ticket 05;
architecture-deepening ticket 06), through ``analyze()``.

Everything runs against ``FakeLLMClient`` and an in-memory parse cache — NO
network, NO infra.
"""

from __future__ import annotations

import json
from contextlib import nullcontext

import pytest

from prospectus_helpers import PDF_BYTES, MemoryS3, ipo_reference, make_parse, settings
from tuju_ai.artifacts import ArtifactStore
from tuju_ai.config import JOB_ANALYZE_PROSPECTUS
from tuju_ai.contracts_generated.job_registry import JOBS
from tuju_ai.llm import (
    CostCeilingExceeded,
    CostTracker,
    FakeLLMClient,
    LLMRuntime,
    MalformedModelOutput,
    Message,
    Usage,
)
from tuju_ai.llm.cost import load_price_table
from tuju_ai.llm.fake import _CANNED
from tuju_ai.prospectus.analysis import (
    LLM_STEPS,
    PROGRESS_STEPS,
    STEPS,
    AnalysisDeps,
    analyze,
)
from tuju_ai.prospectus.analysis_models import IpoReference
from tuju_ai.prospectus.budget import (
    SECTION_CHAR_BUDGET,
    cornerstone_context,
    fit_section,
)

pytestmark = pytest.mark.unit


class RecordingProgress:
    def __init__(self) -> None:
        self.labels: list[str | None] = []

    def advance(self, label: str | None = None) -> None:
        self.labels.append(label)

    def heartbeat(self):
        return nullcontext()


def _run(client: FakeLLMClient | None = None, *, shariah: str | None = "compliant", parse=None, ceiling: float = 2.0):
    client = client or FakeLLMClient()
    parse = parse or make_parse()
    session = LLMRuntime(
        client=client, ceilings_usd={JOB_ANALYZE_PROSPECTUS: ceiling}
    ).session(JOB_ANALYZE_PROSPECTUS)
    progress = RecordingProgress()
    artifact = analyze(
        "p1",
        IpoReference.model_validate(ipo_reference(shariahStatus=shariah)),
        PDF_BYTES,
        AnalysisDeps(
            llm=session,
            parse_fn=lambda _b: parse,
            parse_cache=ArtifactStore(settings(), s3_client=MemoryS3()),
        ),
        progress,
    )
    return artifact, client, session.tracker, progress


# --- the declarative step list ------------------------------------------------------


@pytest.mark.parametrize("step", STEPS, ids=lambda s: s.id)
def test_every_step_has_a_label_a_registry_phase_and_a_valid_fake_reply(step) -> None:
    assert step.label
    assert step.phase in JOBS[JOB_ANALYZE_PROSPECTUS].phases
    assert f"[step:{step.id}]" not in step.task  # the marker is added once, by analyze
    if step.source == "reduce":
        return  # the fake derives the reduce from the outputs it is handed
    step.output.model_validate(_CANNED[step.id])


def test_progress_plan_and_llm_steps_derive_from_steps() -> None:
    assert LLM_STEPS == tuple(s.id for s in STEPS)
    assert PROGRESS_STEPS[0][0] == "parsing-document"
    assert [label for _phase, label in PROGRESS_STEPS[1:]] == [s.label for s in STEPS]
    assert STEPS[-1].source == "reduce"


def test_all_five_sections_and_four_insights_present() -> None:
    artifact, client, _tracker, progress = _run()

    assert set(artifact["sections"]) == {
        "offer", "business", "financials", "riskFactors", "whatToWatch",
    }
    assert set(artifact["insights"]) == {"shariah", "cornerstone", "lockup", "relatedParty"}
    assert artifact["sections"]["offer"]["data"]["useOfProceeds"]
    assert len(artifact["sections"]["business"]["data"]["lines"]) == 3
    assert artifact["sections"]["riskFactors"]["data"]["themes"][0]["rank"] == 1
    assert artifact["insights"]["shariah"]["status"] == "compliant"
    assert artifact["insights"]["cornerstone"]["present"] is True
    assert artifact["insights"]["cornerstone"]["investors"]
    assert artifact["insights"]["lockup"]["entries"][0]["duration"]
    assert artifact["insights"]["lockup"]["routing"]["source"] in ("located", "fallback")
    assert artifact["insights"]["relatedParty"]["items"][0]["counterparty"]
    assert artifact["provenance"]["source"] == "real"
    assert artifact["headline"] == artifact["sections"]["whatToWatch"]["data"]["headline"]
    assert client.steps == [
        "offer", "business", "financials", "risk-factors",
        "cornerstone-investors", "lockup", "related-party", "what-to-watch",
    ]
    assert len(progress.labels) == len(PROGRESS_STEPS)  # parse + one per step
    assert artifact["parse"] == {"parsedNow": True, "reusedParse": False}
    assert artifact["timing"]["parseMs"] >= 0


def test_what_to_watch_is_a_reduce_over_the_structured_outputs() -> None:
    artifact, client, _t, _s = _run()
    watch_call = client.calls[client.steps.index("what-to-watch")]
    joined = "\n".join(m.content for m in watch_call)

    # The reduce prompt embeds the structured outputs (4 sections + lock-up
    # and related-party insights) ...
    marker = "SECTION_OUTPUTS:\n"
    payload, _ = json.JSONDecoder().raw_decode(joined[joined.index(marker) + len(marker):])
    assert set(payload) == {
        "offer", "business", "financials", "riskFactors", "lockup", "relatedParty",
    }
    assert payload["riskFactors"] == artifact["sections"]["riskFactors"]["data"]
    # ... and NOT the raw document text.
    assert "150,000,000 shares at RM0.50" not in joined
    # The fake derives the headline from the top-ranked risk theme it was handed.
    assert "customer concentration" in artifact["headline"].lower()
    # The contract pins derivedFrom to the four SECTIONS fed to the reduce; the
    # lock-up / related-party insights it also reads cannot be listed (yet).
    assert artifact["sections"]["whatToWatch"]["derivedFrom"] == [
        "offer", "business", "financials", "riskFactors",
    ]
    fed = {s.slot[1] for s in STEPS if s.feeds_watch}
    assert fed == set(payload)


def test_located_vs_fallback_is_recorded_per_section() -> None:
    artifact, _c, _t, _s = _run()
    sections = artifact["sections"]
    for name in ("offer", "business", "financials"):
        assert sections[name]["routing"]["source"] == "located"
        assert sections[name]["routing"]["located"] is True
    # make_parse() has no risk-factors heading ⇒ explicit whole-document fallback.
    risk = sections["riskFactors"]["routing"]
    assert risk["source"] == "fallback" and risk["located"] is False
    assert risk["routedChars"] > 0 and risk["inputChars"] > 0


def test_malformed_json_gets_one_retry_then_succeeds() -> None:
    client = FakeLLMClient(garbage_first={"offer": 1})
    artifact, client, _t, _s = _run(client)
    assert client.steps.count("offer") == 2  # bad reply + one retry
    assert artifact["sections"]["offer"]["data"]["priceRange"] == "RM0.50 per share"
    # the retry re-sends the same shared prefix first (cache-friendly) + feedback
    first, second = [c for c, s in zip(client.calls, client.steps) if s == "offer"]
    assert second[:3] == first[:3] or second[:2] == first[:2]
    assert "could not be used" in second[-1].content


def test_malformed_json_twice_is_a_clear_failure() -> None:
    client = FakeLLMClient(garbage_first={"business": 2})
    with pytest.raises(MalformedModelOutput, match="business"):
        _run(client)
    assert client.steps.count("business") == 2  # bounded: exactly one retry


def test_free_model_gets_more_retries_then_succeeds() -> None:
    # $0 model: a retry costs nothing and openrouter/free may route it to a
    # different model, so the bound is MAX_RETRIES_FREE (3), not 1.
    client = FakeLLMClient(model="openrouter/free", garbage_first={"lockup": 3})
    artifact, client, tracker, _s = _run(client)
    assert tracker.free
    assert client.steps.count("lockup") == 4  # 3 bad replies + the good one
    assert artifact["insights"]["lockup"]["entries"]


def test_free_model_retries_are_still_bounded() -> None:
    client = FakeLLMClient(model="openrouter/free", garbage_first={"lockup": 4})
    with pytest.raises(MalformedModelOutput, match="lockup.*3 retries"):
        _run(client)
    assert client.steps.count("lockup") == 4


def test_schema_violation_counts_as_malformed() -> None:
    class BadRisk(FakeLLMClient):
        def complete(self, messages, **kw):  # type: ignore[override]
            resp = super().complete(messages, **kw)
            if self.steps[-1] == "risk-factors":
                return type(resp)(text='{"themes": []}', usage=resp.usage, model=resp.model)
            return resp

    with pytest.raises(MalformedModelOutput, match="risk-factors"):
        _run(BadRisk())


def test_shariah_tolerates_absent_and_unknown() -> None:
    absent, *_ = _run(shariah=None)
    assert absent["insights"]["shariah"]["status"] == "unknown"
    assert absent["insights"]["shariah"]["source"] == "unavailable"
    unknown, *_ = _run(shariah="unknown")
    assert unknown["insights"]["shariah"]["status"] == "unknown"


def test_cornerstone_skips_llm_when_never_mentioned() -> None:
    parse = make_parse(with_cornerstone=False)
    assert cornerstone_context(parse) is None
    artifact, client, _t, _s = _run(parse=parse)
    assert "cornerstone-investors" not in client.steps
    assert artifact["insights"]["cornerstone"]["present"] is False
    assert artifact["insights"]["cornerstone"]["llmCalled"] is False


def test_message_order_is_shared_prefix_first() -> None:
    _a, client, _t, _s = _run()
    for msgs in client.calls:
        assert msgs[0].role == "system" and msgs[0].cache  # shared system prefix
    sec_calls = [c for c, s in zip(client.calls, client.steps) if s == "offer"]
    assert sec_calls[0][1].cache  # document context is the cacheable 2nd block
    assert sec_calls[0][-1].content.startswith("[step:offer]")  # task last


# --- budget ----------------------------------------------------------------


def test_fallback_section_is_bounded_to_the_budget() -> None:
    para = "Revenue of RM1 million was recorded in the financial year.\n\n"
    filler = "Lorem ipsum dolor sit amet consectetur.\n\n"
    whole = (filler * 20000) + (para * 50) + (filler * 20000)  # ~1.6M chars
    assert len(whole) > 5 * SECTION_CHAR_BUDGET
    fitted = fit_section("financials", whole, located=False)
    assert fitted.truncated and fitted.input_chars <= SECTION_CHAR_BUDGET + 1000
    assert "Revenue of RM1 million" in fitted.text  # relevance-selected, not head-only


def test_located_section_keeps_head_and_tail_with_marker() -> None:
    body = "\n\n".join(f"paragraph {i} " + "x" * 200 for i in range(2000))
    fitted = fit_section("business", body, located=True, budget=50_000)
    assert fitted.truncated and len(fitted.text) <= 51_000
    assert fitted.text.startswith("paragraph 0 ")
    assert "paragraph 1999 " in fitted.text
    assert "characters omitted" in fitted.text


def test_whole_document_fallback_sections_stay_bounded_end_to_end() -> None:
    from tuju_ai.prospectus.models import Block, Heading, ProspectusParse

    # 600k-char document with NO recognisable headings ⇒ all four sections fall back.
    blocks = [
        Block(kind="text", text=f"Paragraph {i}: revenue risk shares. " + "y" * 400, headingIndex=0)
        for i in range(1400)
    ]
    parse = ProspectusParse(
        pdfSha256="0" * 64,
        headings=[Heading(text="Front matter", level=1, index=0)],
        blocks=blocks,
    )
    artifact, client, _t, _s = _run(parse=parse)
    for name in ("offer", "business", "financials", "riskFactors"):
        routing = artifact["sections"][name]["routing"]
        assert routing["source"] == "fallback" and routing["routedChars"] > 500_000
        assert routing["truncated"] is True
        assert routing["inputChars"] <= SECTION_CHAR_BUDGET
    for msgs, step in zip(client.calls, client.steps):
        assert sum(len(m.content) for m in msgs) <= SECTION_CHAR_BUDGET + 10_000, step


def test_small_section_is_untouched() -> None:
    fitted = fit_section("offer", "short text", located=True)
    assert fitted.text == "short text" and not fitted.truncated


# --- cost guard ----------------------------------------------------------------


def test_realistic_run_stays_well_under_the_2_usd_ceiling() -> None:
    # Worst-case-sized fake usage per call: a maxed-out 240k-char section
    # (~80k tokens in) + full output, for every one of the 8 LLM steps.
    usage = Usage(prompt_tokens=80_000, completion_tokens=3_000)
    artifact, _c, tracker, _s = _run(FakeLLMClient(model="google/gemini-2.5-flash", usage=usage))
    cost = artifact["cost"]
    assert cost["calls"] == 8
    assert cost["promptTokens"] == 8 * 80_000
    assert 0 < cost["estimatedCostUsd"] < 2.0
    assert cost["estimatedCostUsd"] < 0.5  # Flash is cheap: ~0.25 here
    assert cost["ceilingUsd"] == 2.0
    assert tracker.spent_usd == pytest.approx(cost["estimatedCostUsd"])


def test_every_builtin_model_fits_the_ceiling_at_worst_case_budget() -> None:
    """The documented input budget (budget.py) fits $2/doc even on Sonnet."""
    from tuju_ai.prospectus.budget import CORNERSTONE_CHAR_BUDGET
    from tuju_ai.llm.cost import CHARS_PER_TOKEN_ESTIMATE, DEFAULT_PRICE_TABLE, usage_cost_usd

    worst_in = (6 * SECTION_CHAR_BUDGET + CORNERSTONE_CHAR_BUDGET) // CHARS_PER_TOKEN_ESTIMATE
    worst_out = 7 * 3000 + 1500
    for model, price in DEFAULT_PRICE_TABLE.items():
        # +10% for prompts/system overhead and the reduce input.
        cost = usage_cost_usd(Usage(int(worst_in * 1.1), worst_out), price)
        assert cost < 2.0, f"{model} worst-case ${cost:.2f} breaches the ceiling"


def test_cost_guard_aborts_mid_run_when_usage_exceeds_the_ceiling() -> None:
    # Each call reports $-heavy usage; the ceiling trips after a few steps.
    usage = Usage(prompt_tokens=1_000_000, completion_tokens=100_000)
    client = FakeLLMClient(model="google/gemini-2.5-flash", usage=usage)
    with pytest.raises(CostCeilingExceeded):
        _run(client)
    # Aborted mid-run: later steps never ran (no spend on the reduce).
    assert "what-to-watch" not in client.steps
    assert len(client.steps) < 6


def test_cost_guard_refuses_a_call_projected_to_cross_the_ceiling() -> None:
    client = FakeLLMClient()
    tracker = CostTracker(model="anthropic/claude-sonnet-4.5", ceiling_usd=0.01)
    huge = [Message("user", "x" * 3_000_000 + "[step:offer]")]
    with pytest.raises(CostCeilingExceeded, match="projected"):
        tracker.call(client, "offer", huge, max_tokens=3000)
    assert client.calls == []  # refused BEFORE paying for the call


def test_unknown_model_is_priced_conservatively() -> None:
    t = CostTracker(model="mystery/model", ceiling_usd=10.0)
    t.record("x", Usage(prompt_tokens=1_000_000, completion_tokens=0))
    assert t.spent_usd == pytest.approx(3.0)  # the priciest known input rate (Sonnet)


def test_free_router_costs_nothing_and_never_trips_the_guard() -> None:
    """openrouter/free (the default model): $0 even on worst-case usage, and a
    tiny ceiling cannot abort it."""
    usage = Usage(prompt_tokens=1_000_000, completion_tokens=100_000)
    artifact, client, tracker, _s = _run(
        FakeLLMClient(model="openrouter/free", usage=usage), ceiling=0.01
    )
    assert artifact["cost"]["estimatedCostUsd"] == 0.0
    assert "what-to-watch" in client.steps  # ran to the end


def test_free_suffixed_models_cost_nothing() -> None:
    t = CostTracker(model="nvidia/nemotron-3-ultra-550b-a55b:free", ceiling_usd=0.01)
    t.record("x", Usage(prompt_tokens=1_000_000, completion_tokens=100_000))
    assert t.spent_usd == 0.0


class _RoutedFakeClient(FakeLLMClient):
    """A router: the response names a different serving model per call."""

    SERVED = ("google/gemma-4-31b-it:free", "meta-llama/llama-4-scout:free")

    def complete(self, messages, **kwargs):  # noqa: ANN001, ANN003, ANN201
        response = super().complete(messages, **kwargs)
        served = self.SERVED[(len(self.calls) - 1) % len(self.SERVED)]
        return type(response)(text=response.text, usage=response.usage, model=served)


def test_provenance_and_cost_record_the_models_that_actually_answered() -> None:
    from tuju_ai.contracts_generated import ProspectusCostReport

    artifact, _c, _t, _s = _run(_RoutedFakeClient(model="openrouter/free"))

    assert artifact["provenance"]["model"] == ", ".join(_RoutedFakeClient.SERVED)
    per_call = artifact["cost"]["perCall"]
    assert {c["model"] for c in per_call} == set(_RoutedFakeClient.SERVED)
    assert artifact["cost"]["model"] == "openrouter/free"  # what was requested
    ProspectusCostReport.model_validate(artifact["cost"])  # wire-contract conformant


def test_price_table_override_is_honoured_and_validated() -> None:
    table = load_price_table('{"x/y": {"input": 1, "output": 2, "cachedInput": 0.5}}')
    assert table["x/y"].cached_input == 0.5
    with pytest.raises(ValueError):
        load_price_table("not json")
