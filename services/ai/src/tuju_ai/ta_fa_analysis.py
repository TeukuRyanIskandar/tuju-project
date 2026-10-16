"""Technical & Fundamental Analysis jobs (poc-phase-a-worker ticket 10).

Two :class:`~tuju_ai.jobs.pipeline.JobDefinition`\ s whose ``work()`` is:
fetch the code-verified reference → assemble facts/metrics → narrate under the
grounding + no-advice validators → build the artifact. The pipeline owns
validation, progress, the contract pre-write check and the claim-check.

Narration degrades to facts-only (placeholder narrative + ``facts-only: ``
headline) when the cost ceiling or the grounding retries are exhausted; a
reply that never parses is terminal.
"""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from .config import JOB_ANALYZE_FUNDAMENTAL, JOB_ANALYZE_TECHNICAL
from .contracts_generated import (
    FundamentalAnalysisArtifact,
    FundamentalJobEnvelope,
    FundamentalMetric,
    TechnicalAnalysisArtifact,
    TechnicalEvent,
    TechnicalFacts,
    TechnicalJobEnvelope,
    TechnicalMacdFacts,
    TechnicalRsiFacts,
    TechnicalSmaFacts,
    TechnicalWeek52Facts,
)
from .errors import TerminalJobError
from .jobs.pipeline import JobContext, JobDefinition, JobOutput, hour_bucket, now
from .llm import CostCeilingExceeded, LLMSession, Message, OutputRejected, ask
from .llm.grounding import advice_term, ungrounded_number

# Facts-only degrade (poc-phase-a-worker tickets 04-06): the facts are
# verified, only the wording failed, so the run still lands an artifact with a
# placeholder narrative and a `facts-only: ` headline the backend hook reads.
WITHHELD_BY_COST = (
    "Narrative withheld: narration stopped by cost guard.",
    "facts-only: Narration stopped by cost guard.",
)
WITHHELD_BY_GROUNDING = (
    "Narrative withheld: failed the grounding check.",
    "facts-only: Grounding check failed.",
)
NARRATE_STEP = "narrate"
NARRATE_MAX_TOKENS = 300


class NarrativeOutput(BaseModel):
    narrative: str = Field(min_length=1)


def narrate(
    session: LLMSession, messages: list[Message], *sources: Any
) -> tuple[str, str | None]:
    """Narrate ``sources`` under the grounding + no-advice validators.

    Returns ``(narrative, facts_only_headline)``; the headline is ``None`` on a
    clean narration. Cost-ceiling or grounding exhaustion degrades to the
    facts-only placeholder; a reply that never parses raises
    :class:`MalformedModelOutput` (terminal).
    """
    try:
        out = ask(
            session,
            NARRATE_STEP,
            messages,
            NarrativeOutput,
            max_tokens=NARRATE_MAX_TOKENS,
            validators=[
                lambda o: ungrounded_number(o.narrative, *sources),
                lambda o: advice_term(o.narrative),
            ],
        )
    except CostCeilingExceeded:
        return WITHHELD_BY_COST
    except OutputRejected:
        return WITHHELD_BY_GROUNDING
    return out.narrative, None


def generate_ta_headline(facts: dict, events: list) -> str:
    """Generate TA headline from first fired event or key metric."""
    for event in events:
        if isinstance(event, dict) and event.get("fired"):
            return event.get("label", "Data unavailable for analysis")
    return "Data unavailable for analysis"


# Headline number precision, matching the frontend's `factValue` maximum
# fraction digits: both sides round here so they cannot disagree about a number.
HEADLINE_PRECISION = 4


def _scaled_value(metric: dict) -> float:
    """The metric's value in whole units of its ``unit``.

    ``scale`` picks the number, ``unit`` stays the suffix: a ``fraction`` metric
    is stored as a fraction of its unit (0.045 with unit ``%`` is 4.5%), while a
    ``percentage_point`` or ``absolute`` one already is in whole units.

    This is the rule the frontend's ``metricValue`` is being moved onto
    (blocker-fix ticket 04, which today still branches on metric id). Both sides
    derive the number from ``scale`` alone so a fraction is never printed with a
    bare ``%``, and the headline cannot disagree with the panel about a value.
    """
    value = metric["value"]
    return value * 100 if metric.get("scale") == "fraction" else value


def _headline_number(value: float) -> str:
    """Format at :data:`HEADLINE_PRECISION`, dropping float noise.

    ``0.29 * 100`` is ``28.999999999999996`` in binary floating point, and the
    fixed-precision format is also what keeps a large absolute value like
    4200000000 out of ``%g``'s exponent form.
    """
    return f"{value:.{HEADLINE_PRECISION}f}".rstrip("0").rstrip(".")


def generate_fa_headline(metrics: list) -> str:
    """Generate FA headline from most compelling non-null metric."""
    for metric in metrics:
        if isinstance(metric, dict) and metric.get("value") is not None:
            label = metric.get("label", "")
            unit = metric.get("unit", "")
            value = _headline_number(_scaled_value(metric))
            return f"{label} {value}{unit}".strip()
    return "Data unavailable for analysis"


def build_ta_messages(
    symbol: str, timeframe: str, facts: dict, events: list
) -> list[Message]:
    """Build TA system + user messages for LLM narration."""
    system = """\
You are an expert technical analyst tasked with describing what the market data
shows for a stock, without offering investment advice.

You are speaking to a private demo panel reviewing a Python AI system's
capabilities. Your role is to state facts about market patterns and price
movement clearly and honestly.

CRITICAL RULES:
1. Use ONLY the numbers and events present in the data packet you receive.
   Do not compute new metrics or make up values.
2. If a metric is null or missing, state that absence explicitly
   (e.g., "RSI data is unavailable").
3. Never recommend buying, selling, or holding.
4. Never suggest price targets or valuations.
5. Never use advice-shaped language ("investors should consider...").
6. Keep your narrative concise, approximately 80–150 words.
7. Respond only with a JSON object containing a "narrative" field.

The narrative should describe what the data shows: trends, pattern matches,
and where price sits relative to key moving averages and volatility bands.
"""

    user = f"""\
Analyze the following technical data for {symbol} on the {timeframe} timeframe.

Respond with valid JSON:

{{
  "narrative": "<your narrative here>"
}}

Technical facts packet:
{json.dumps(facts, indent=2)}

Fired events (technical signals):
{json.dumps(events, indent=2)}

Instructions:
- Use ONLY numbers present in the facts or events above.
- If a value is null, explicitly state the absence (e.g., "RSI data unavailable").
- Describe price location, trend direction, and pattern matches.
- Do not make up numbers or compute new metrics.

[step:narrate]
"""

    return [
        Message("system", system, cache=True),
        Message("user", user),
    ]


def build_fa_messages(
    symbol: str, period: str, metrics: list
) -> list[Message]:
    """Build FA system + user messages for LLM narration."""
    system = """\
You are a fundamental analyst tasked with describing what the financial data
shows for a company, without offering investment advice.

You are speaking to a private demo panel reviewing a Python AI system's
capabilities. Your role is to state facts about financial health, growth
trends, and valuation metrics clearly and honestly.

CRITICAL RULES:
1. Use ONLY the numbers and metrics present in the data packet you receive.
   Do not compute new metrics or make up values. The single exception is the
   fraction rendering in rule 2.
2. Every metric carries a "scale". "fraction" means the value is a fraction of
   the metric's unit, so 0.045 with unit "%" reads as 5.67%; "percentage_point"
   and "absolute" are already in whole units. State a fraction in whole units
   of its unit. This is the only transformation you may perform.
3. If a metric is null or missing, state that absence explicitly
   (e.g., "Operating cash flow data is unavailable").
4. Never recommend buying, selling, or holding.
5. Never suggest price targets, fair values, or intrinsic valuations.
6. Never use advice-shaped language ("investors should consider...").
7. Keep your narrative concise, approximately 80–150 words.
8. Respond only with a JSON object containing a "narrative" field.

The narrative should describe what the data shows: profitability trends,
growth rates, leverage, and valuation context.
"""

    user = f"""\
Analyze the following fundamental data for {symbol} ({period} period).

Respond with valid JSON:

{{
  "narrative": "<your narrative here>"
}}

Fundamental metrics:
{json.dumps(metrics, indent=2)}

Instructions:
- Use ONLY numbers and metrics present in the list above.
- Respect each metric's "scale": render a "fraction" in whole units of its
  unit, and use every other number exactly as it appears.
- If a value is null, explicitly state the absence (e.g., "Operating cash flow data unavailable").
- Describe profitability, growth trends, valuation relative to history, and financial health.
- Do not make up numbers or compute new metrics.

[step:narrate]
"""

    return [
        Message("system", system, cache=True),
        Message("user", user),
    ]


def _provenance(session: LLMSession) -> dict[str, Any]:
    return {
        "source": "real",
        "adapter": "yfinance",
        "model": session.model,
        "generatedAt": now(),
    }


# --- analyze-technical -------------------------------------------------------


def _technical_work(envelope: TechnicalJobEnvelope, ctx: JobContext) -> JobOutput:
    session = ctx.llm_session()  # no key ⇒ terminal, before any fetch
    symbol = envelope.payload.symbol
    timeframe = envelope.payload.timeframe

    ctx.advance(f"Fetching data for {symbol}")
    reference = ctx.read(
        lambda: ctx.deps.backend.get_analysis_reference(symbol),
        unknown=f"symbol {symbol!r}",
    )
    technical = reference.get("technical")
    if not technical:
        raise TerminalJobError(f"Empty or missing technical facts for {symbol}")

    ctx.advance()
    technical_facts = TechnicalFacts(
        sma=TechnicalSmaFacts(
            p20=technical.get("sma", {}).get("p20"),
            p50=technical.get("sma", {}).get("p50"),
            p200=technical.get("sma", {}).get("p200"),
        ),
        rsi=TechnicalRsiFacts(
            period=14,
            value=technical.get("rsi", {}).get("value"),
        ),
        macd=TechnicalMacdFacts(
            line=technical.get("macd", {}).get("line"),
            signal=technical.get("macd", {}).get("signal"),
            histogram=technical.get("macd", {}).get("histogram"),
        ),
        week52=TechnicalWeek52Facts(
            high=technical.get("week52", {}).get("high"),
            low=technical.get("week52", {}).get("low"),
        ),
    )
    events = [
        TechnicalEvent(
            id=e.get("id"),
            label=e.get("label", ""),
            fired=e.get("fired", False),
            values=e.get("values", {}),
            at=e.get("at"),
        )
        for e in reference.get("technicalEvents", [])
    ]

    ctx.advance()
    facts_dict = technical_facts.model_dump(mode="json")
    events_list = [e.model_dump(mode="json") for e in events]
    narrative_text, facts_only = narrate(
        session,
        build_ta_messages(symbol, timeframe, facts_dict, events_list),
        facts_dict,
        events_list,
    )
    headline = facts_only or generate_ta_headline(facts_dict, events_list)

    artifact = {
        "schemaVersion": ctx.schema_version,
        "symbol": symbol,
        "jobName": JOB_ANALYZE_TECHNICAL,
        "asOf": envelope.asOf,
        "timeframe": timeframe,
        "facts": facts_dict,
        "events": events_list,
        "narrative": {"language": "en", "text": narrative_text},
        "provenance": _provenance(session),
        "cost": session.tracker.report(),
    }
    return JobOutput(
        artifact_key=f"technical/{symbol}/{hour_bucket(envelope.asOf)}.json",
        artifact=artifact,
        headline=headline,
    )


TECHNICAL_JOB = JobDefinition(
    name=JOB_ANALYZE_TECHNICAL,
    envelope=TechnicalJobEnvelope,
    result_key=lambda e: f"{e.payload.symbol}:{e.payload.timeframe}:{hour_bucket(e.asOf)}",
    work_steps=[
        ("fetching-market-data", "Fetching market data"),
        ("computing-indicators", "Computing indicators"),
        ("synthesizing-verdict", "Synthesizing verdict"),
    ],
    work=_technical_work,
    artifact_contract=TechnicalAnalysisArtifact,
)


# --- analyze-fundamental -----------------------------------------------------

EXPECTED_METRIC_COUNT = 9


def _fundamental_work(envelope: FundamentalJobEnvelope, ctx: JobContext) -> JobOutput:
    symbol = envelope.payload.symbol
    period = envelope.payload.period
    if period == "annual":
        raise TerminalJobError("Annual period not yet supported")
    session = ctx.llm_session()  # no key ⇒ terminal, before any fetch

    ctx.advance(f"Fetching financials for {symbol}")
    reference = ctx.read(
        lambda: ctx.deps.backend.get_analysis_reference(symbol),
        unknown=f"symbol {symbol!r}",
    )
    metrics_raw = (reference.get("fundamental") or {}).get("metrics") or []
    if not metrics_raw:
        raise TerminalJobError(f"Empty or missing fundamental metrics for {symbol}")

    ctx.advance()
    if len(metrics_raw) != EXPECTED_METRIC_COUNT:
        raise TerminalJobError(
            f"Expected {EXPECTED_METRIC_COUNT} fundamental metrics, got {len(metrics_raw)}"
        )
    # `scale` is required by the contract, so a metric built without one is a
    # producer that has not shipped it. Never default to 'absolute': that
    # relabels a fraction as a whole number, the exact mislabelling the field
    # exists to prevent. Absent and explicitly null are both terminal.
    for m in metrics_raw:
        if m.get("scale") is None:
            raise TerminalJobError(
                f"Missing metric scale for {symbol} "
                f"{(m.get('id') or 'unknown')!r}; the reference must declare it"
            )
    # Anything else the reference gets wrong about a metric is just as
    # permanent, and `run_job` only maps LLM errors, so an escaping
    # ValidationError would be retried by BullMQ and burn queue attempts.
    try:
        metrics = [
            FundamentalMetric(
                id=m.get("id"),
                label=m.get("label", ""),
                value=m.get("value"),
                unit=m.get("unit", ""),
                scale=m.get("scale"),
                asOf=m.get("asOf"),
            )
            for m in metrics_raw
        ]
    except ValidationError as exc:
        raise TerminalJobError(
            f"Fundamental metrics for {symbol} failed contract validation: {exc}"
        ) from exc

    ctx.advance()
    metrics_list = [m.model_dump(mode="json") for m in metrics]
    narrative_text, facts_only = narrate(
        session, build_fa_messages(symbol, period, metrics_list), metrics_list
    )
    headline = facts_only or generate_fa_headline(metrics_list)

    artifact = {
        "schemaVersion": ctx.schema_version,
        "symbol": symbol,
        "jobName": JOB_ANALYZE_FUNDAMENTAL,
        "asOf": envelope.asOf,
        "period": period,
        "metrics": metrics_list,
        "narrative": {"language": "en", "text": narrative_text},
        "provenance": _provenance(session),
        "cost": session.tracker.report(),
    }
    return JobOutput(
        artifact_key=f"fundamental/{symbol}/{hour_bucket(envelope.asOf)}.json",
        artifact=artifact,
        headline=headline,
    )


FUNDAMENTAL_JOB = JobDefinition(
    name=JOB_ANALYZE_FUNDAMENTAL,
    envelope=FundamentalJobEnvelope,
    result_key=lambda e: f"{e.payload.symbol}:{e.payload.period}:{hour_bucket(e.asOf)}",
    work_steps=[
        ("fetching-financials", "Fetching financials"),
        ("computing-metrics", "Computing metrics"),
        ("synthesizing-verdict", "Synthesizing verdict"),
    ],
    work=_fundamental_work,
    artifact_contract=FundamentalAnalysisArtifact,
)
