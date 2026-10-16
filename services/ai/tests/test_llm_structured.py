"""The LLM runtime + structured call (architecture-deepening ticket 03).

``ask()`` is driven through ``FakeLLMClient`` replies only: no monkeypatching,
no env mutation, no network.
"""

from __future__ import annotations

import pytest
from pydantic import BaseModel, Field

from prospectus_helpers import settings
from tuju_ai.config import (
    JOB_ANALYZE_FUNDAMENTAL,
    JOB_ANALYZE_PROSPECTUS,
    JOB_ANALYZE_TECHNICAL,
)
from tuju_ai.llm import (
    CostCeilingExceeded,
    FakeLLMClient,
    LLMConfigError,
    LLMRuntime,
    MalformedModelOutput,
    Message,
    OutputRejected,
    LLMResponse,
    Usage,
    ask,
    extract_json,
)
from tuju_ai.llm.base import ResponseMetadata
from tuju_ai.llm.grounding import advice_term, ungrounded_number

pytestmark = pytest.mark.unit

PAID = "google/gemini-2.5-flash"
FREE = "openrouter/free"


class Narrative(BaseModel):
    narrative: str = Field(min_length=1)


def _messages() -> list[Message]:
    return [
        Message("system", "You narrate.", cache=True),
        Message("user", "[step:narrate]\nNarrate the facts."),
    ]


def _session(client: FakeLLMClient, job: str = JOB_ANALYZE_TECHNICAL):
    return LLMRuntime(client=client).session(job)


def _ask(client: FakeLLMClient, validators=()):
    return ask(
        _session(client), "narrate", _messages(), Narrative,
        max_tokens=300, validators=validators,
    )


# --- retry / echo ----------------------------------------------------------------


def test_garbage_then_valid_reply_succeeds_on_the_corrective_retry() -> None:
    client = FakeLLMClient(model=PAID, garbage_first={"narrate": 1})
    out = _ask(client)

    assert out.narrative.startswith("Fake:")
    assert client.steps == ["narrate", "narrate"]
    first, retry = client.calls
    # The retry resends the ORIGINAL prefix (cache-friendly), then echoes the
    # bad reply and asks again.
    assert retry[: len(first)] == first
    assert retry[-2].role == "assistant" and "no JSON" in retry[-2].content
    assert retry[-1].content.startswith("[step:narrate] Your previous reply could not be used")


def test_paid_model_gets_exactly_one_retry() -> None:
    client = FakeLLMClient(model=PAID, garbage_first={"narrate": 2})
    with pytest.raises(MalformedModelOutput, match="narrate.*1 retry"):
        _ask(client)
    assert client.steps == ["narrate", "narrate"]


def test_free_model_gets_more_retries_but_is_still_bounded() -> None:
    client = FakeLLMClient(model=FREE, garbage_first={"narrate": 3})
    assert _ask(client).narrative
    assert len(client.steps) == 4

    client = FakeLLMClient(model=FREE, garbage_first={"narrate": 4})
    with pytest.raises(MalformedModelOutput, match="3 retries"):
        _ask(client)
    assert len(client.steps) == 4


def test_retry_echo_is_capped() -> None:
    class Rambler(FakeLLMClient):
        def complete(self, messages, **kw):  # type: ignore[override]
            resp = super().complete(messages, **kw)
            if len(self.calls) == 1:
                return type(resp)(text="x" * 10_000, usage=resp.usage, model=resp.model)
            return resp

    client = Rambler(model=PAID)
    _ask(client)
    assert len(client.calls[1][-2].content) == 2000


def test_schema_violation_counts_as_malformed() -> None:
    class Empty(FakeLLMClient):
        def complete(self, messages, **kw):  # type: ignore[override]
            resp = super().complete(messages, **kw)
            return type(resp)(text='{"narrative": ""}', usage=resp.usage, model=resp.model)

    with pytest.raises(MalformedModelOutput):
        _ask(Empty(model=PAID))


class ScriptedReply(FakeLLMClient):
    """Returns one response shape repeatedly to exercise terminal classification."""

    def __init__(self, text: str, metadata: ResponseMetadata) -> None:
        super().__init__(model=PAID)
        self._text = text
        self._metadata = metadata

    def complete(self, messages, **kw):  # type: ignore[override]
        response = super().complete(messages, **kw)
        return LLMResponse(
            text=self._text,
            usage=response.usage,
            model=response.model,
            response_metadata=self._metadata,
        )


def test_empty_reply_reports_provider_metadata_not_a_json_shape_failure() -> None:
    client = ScriptedReply(
        "   ",
        ResponseMetadata(
            finish_reason="length",
            content_empty=True,
            completion_tokens=300,
            reasoning_present=True,
            reasoning_length=42,
        ),
    )

    with pytest.raises(
        MalformedModelOutput,
        match=(
            "model returned an empty reply.*finish_reason=length.*"
            "completion_tokens=300.*content_empty=true.*reasoning_present=true"
        ),
    ):
        _ask(client)
    assert client.steps == ["narrate", "narrate"]


def test_unparseable_reply_reports_its_distinct_terminal_reason() -> None:
    client = ScriptedReply(
        "not JSON",
        ResponseMetadata(finish_reason="stop", completion_tokens=12),
    )

    with pytest.raises(MalformedModelOutput, match="model returned an unparseable reply"):
        _ask(client)


def test_schema_invalid_reply_reports_its_distinct_terminal_reason() -> None:
    client = ScriptedReply(
        '{"narrative": 123}',
        ResponseMetadata(finish_reason="stop", completion_tokens=12),
    )

    with pytest.raises(MalformedModelOutput, match="model returned a schema-invalid reply"):
        _ask(client)


# --- validators -------------------------------------------------------------------


def test_validator_rejection_is_fed_back_then_exhausts_as_rejected() -> None:
    client = FakeLLMClient(model=PAID)
    always_no = lambda out: "number '42' is not in the facts"  # noqa: E731
    with pytest.raises(OutputRejected, match="42"):
        _ask(client, validators=[always_no])
    assert len(client.steps) == 2
    assert "number '42' is not in the facts" in client.calls[1][-1].content


def test_validators_run_in_order_and_stop_at_the_first_reason() -> None:
    seen: list[str] = []

    def first(out):
        seen.append("first")
        return None

    def second(out):
        seen.append("second")
        return None

    _ask(FakeLLMClient(model=PAID), validators=[first, second])
    assert seen == ["first", "second"]


def test_grounding_validators() -> None:
    facts = {"rsi": {"value": 57.4}, "sma": {"p20": 9.7}}
    assert ungrounded_number("RSI is 57.4 and the short average is 9.7", facts) is None
    assert ungrounded_number("RSI sits near 57", facts) is None  # integer part
    assert "61" in ungrounded_number("RSI is 61", facts)
    assert ungrounded_number("1,500.25 points", {"level": 1500.25}) is None
    assert advice_term("Investors should consider a BUY") is not None
    assert advice_term("Price is above all moving averages") is None


def test_grounding_accepts_a_fraction_rendered_in_whole_units() -> None:
    """A `fraction` metric's honest rendering must not read as an ungrounded number."""
    metrics = [{"id": "dividend_yield", "value": 0.045, "unit": "%", "scale": "fraction"}]

    assert ungrounded_number("Dividend yield is 4.5%", metrics) is None
    assert ungrounded_number("Dividend yield is 4.5", metrics) is None
    assert ungrounded_number("Dividend yield is 0.045", metrics) is None  # the raw ratio
    # the integer part of the scaled rendering is grounded too
    assert ungrounded_number("Dividend yield is 4%", metrics) is None
    # but a mis-placed decimal, a wrong figure, or float noise is not
    assert "47" in ungrounded_number("Dividend yield is 47%", metrics)
    assert "4.57" in ungrounded_number("Dividend yield is 4.57%", metrics)
    assert ungrounded_number("Dividend yield is 28.999999999999996%", [
        {"value": 0.29, "unit": "%", "scale": "fraction"},
    ])


def test_grounding_leaves_a_non_fraction_scale_alone() -> None:
    """Only `fraction` gains a converted rendering; the others have nothing to convert."""
    for scale in ("percentage_point", "absolute"):
        metrics = [{"value": 8.4, "unit": "%", "scale": scale}]
        assert ungrounded_number("The reading is 8.4%", metrics) is None
        assert "840" in ungrounded_number("The reading is 840%", metrics)


# --- cost --------------------------------------------------------------------------


def test_ceiling_crossed_mid_retry_propagates_as_cost_exceeded() -> None:
    client = FakeLLMClient(
        model=PAID,
        garbage_first={"narrate": 1},
        usage=Usage(prompt_tokens=20_000, completion_tokens=0),  # $0.006 per call
    )
    runtime = LLMRuntime(client=client, ceilings_usd={JOB_ANALYZE_TECHNICAL: 0.01})
    with pytest.raises(CostCeilingExceeded):
        ask(runtime.session(JOB_ANALYZE_TECHNICAL), "narrate", _messages(), Narrative, max_tokens=300)
    assert len(client.steps) == 2  # the retry was paid for, then the guard tripped


def test_every_call_is_metered_into_the_session_report() -> None:
    client = FakeLLMClient(model=PAID, garbage_first={"narrate": 1})
    session = _session(client)
    ask(session, "narrate", _messages(), Narrative, max_tokens=300)
    report = session.tracker.report()
    assert report["calls"] == 2
    assert [c["step"] for c in report["perCall"]] == ["narrate", "narrate"]


# --- runtime ------------------------------------------------------------------------


def test_runtime_has_a_ceiling_per_llm_job_kind() -> None:
    runtime = LLMRuntime(client=FakeLLMClient())
    assert runtime.session(JOB_ANALYZE_TECHNICAL).tracker.ceiling_usd == 0.10
    assert runtime.session(JOB_ANALYZE_FUNDAMENTAL).tracker.ceiling_usd == 0.10
    assert runtime.session(JOB_ANALYZE_PROSPECTUS).tracker.ceiling_usd == 2.0
    # each session meters its own run
    a, b = runtime.session(JOB_ANALYZE_TECHNICAL), runtime.session(JOB_ANALYZE_TECHNICAL)
    assert a.tracker is not b.tracker


def test_runtime_without_a_client_refuses_a_session() -> None:
    with pytest.raises(LLMConfigError, match="OPENROUTER_API_KEY.*analyze-prospectus"):
        LLMRuntime(client=None).session(JOB_ANALYZE_PROSPECTUS)


def test_runtime_from_settings() -> None:
    assert LLMRuntime.from_settings(settings()).configured is False
    runtime = LLMRuntime.from_settings(
        settings(
            openrouter_api_key="k",
            llm_model="google/gemini-2.5-pro",
            cost_ceiling_usd=3.0,
            narration_cost_ceiling_usd=0.05,
            llm_price_table_json='{"google/gemini-2.5-pro": {"input": 9, "output": 9}}',
        )
    )
    assert runtime.client is not None and runtime.client.model == "google/gemini-2.5-pro"
    assert "k" not in repr(runtime.client).replace("OpenRouterClient", "")
    assert runtime.ceilings_usd[JOB_ANALYZE_PROSPECTUS] == 3.0
    assert runtime.ceilings_usd[JOB_ANALYZE_TECHNICAL] == 0.05
    assert runtime.price_table["google/gemini-2.5-pro"].input == 9


# --- JSON extraction --------------------------------------------------------------


def test_extract_json_tolerates_fences_and_prose() -> None:
    assert extract_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert extract_json('Here you go: {"a": 2} hope that helps') == {"a": 2}
    with pytest.raises(ValueError):
        extract_json("no json at all")
