"""Technical & Fundamental Analysis handlers (ticket 10).

Two flat handlers validate → fetch reference → assemble facts → narrate → post-check → claim-check.
No LangGraph (ADR-0003 scope); corrective LLM retry on malformed output; grounding post-check
with number containment and ban-word scan; $0.10 cost ceiling per job.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Callable

import httpx
from pydantic import ValidationError

from .artifacts import ArtifactStore
from .backend_client import BackendClient
from .config import JOB_ANALYZE_FUNDAMENTAL, JOB_ANALYZE_TECHNICAL
from .contracts_generated import (
    AnalysisNarrative,
    AnalysisProvenance,
    FundamentalAnalysisArtifact,
    FundamentalJobEnvelope,
    FundamentalMetric,
    JobProgress,
    JobResult,
    ProspectusCostReport,
    SCHEMA_VERSIONS,
    SystemSummary,
    TechnicalAnalysisArtifact,
    TechnicalEvent,
    TechnicalFacts,
    TechnicalJobEnvelope,
    TechnicalMacdFacts,
    TechnicalRsiFacts,
    TechnicalSmaFacts,
    TechnicalWeek52Facts,
)
from .logging_config import get_logger
from .llm import CostCeilingExceeded, CostTracker, LLMClient, Message
from .llm.cost import DEFAULT_PRICE_TABLE

ProgressReporter = Callable[[JobProgress], None]

BAN_WORDS = {
    "buy",
    "sell",
    "hold",
    "target",
    "price target",
    "undervalued",
    "overvalued",
    "underweight",
    "overweight",
    "recommendation",
    "recommend",
    "advise",
    "should invest",
    "should buy",
}

NUMBER_REGEX = re.compile(
    r"(?:RM)?[\d,]+\.?\d*\s*%?|[\d.]+%|[\d,]+(?:\.\d+)?"
)


def _now() -> datetime:
    """Get current UTC time."""
    return datetime.now(timezone.utc)


def _progress(step: int, total: int, phase: str, label: str):
    """Build a JobProgress."""
    from .contracts_generated import JobProgress
    return JobProgress(
        stepIndex=step, stepTotal=total, phase=phase, label=label, at=_now()
    )


def _extract_numbers(text: str) -> set[str]:
    """Extract all numbers from narrative text and normalize them."""
    matches = NUMBER_REGEX.findall(text)
    numbers = set()
    for m in matches:
        normalized = m.replace(",", "").replace(" ", "").strip()
        if normalized.endswith("%"):
            normalized = normalized[:-1]
        numbers.add(normalized)
        if "." in normalized:
            numbers.add(normalized.split(".")[0])
    return numbers


def _collect_fact_numbers(facts_or_metrics: Any) -> set[str]:
    """Collect all numeric values from facts/events/metrics dicts."""
    numbers = set()

    def _visit(obj: Any) -> None:
        if isinstance(obj, dict):
            for v in obj.values():
                _visit(v)
        elif isinstance(obj, (list, tuple)):
            for item in obj:
                _visit(item)
        elif isinstance(obj, (int, float)):
            s = str(obj)
            numbers.add(s)
            if "." in s:
                numbers.add(s.split(".")[0])

    _visit(facts_or_metrics)
    return numbers


def check_grounding(
    text: str, facts_or_metrics: Any, events: list | None = None
) -> tuple[bool, str | None]:
    """Check narrative for number grounding and banned terms."""
    narrative_numbers = _extract_numbers(text)

    if events is None:
        events = []
    fact_numbers = _collect_fact_numbers(facts_or_metrics)
    fact_numbers.update(_collect_fact_numbers(events))

    for num in narrative_numbers:
        if num and num not in fact_numbers:
            return False, f"number {num!r} not found in facts"

    text_lower = text.lower()
    for banned in BAN_WORDS:
        if banned in text_lower:
            return False, f"banned term: {banned!r}"

    return True, None


def generate_ta_headline(facts: dict, events: list) -> str:
    """Generate TA headline from first fired event or key metric."""
    for event in events:
        if isinstance(event, dict) and event.get("fired"):
            return event.get("label", "Data unavailable for analysis")
    return "Data unavailable for analysis"


def generate_fa_headline(metrics: list) -> str:
    """Generate FA headline from most compelling non-null metric."""
    for metric in metrics:
        if isinstance(metric, dict) and metric.get("value") is not None:
            label = metric.get("label", "")
            value = metric.get("value")
            unit = metric.get("unit", "")
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
   Do not compute new ratios or make up values.
2. If a metric is null or missing, state that absence explicitly
   (e.g., "Operating cash flow data is unavailable").
3. Never recommend buying, selling, or holding.
4. Never suggest price targets, fair values, or intrinsic valuations.
5. Never use advice-shaped language ("investors should consider...").
6. Keep your narrative concise, approximately 80–150 words.
7. Respond only with a JSON object containing a "narrative" field.

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
- If a value is null, explicitly state the absence (e.g., "Operating cash flow data unavailable").
- Describe profitability, growth trends, valuation relative to history, and financial health.
- Do not make up numbers or compute new metrics.

[step:narrate]
"""

    return [
        Message("system", system, cache=True),
        Message("user", user),
    ]


def _get_llm_client() -> LLMClient:
    """Get the LLM client (real only; missing config is a terminal job error)."""
    import os
    from .handler import TerminalJobError
    from .llm.openrouter import OpenRouterClient

    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    model = os.environ.get("LLM_MODEL", "").strip()

    if not api_key or not model:
        raise TerminalJobError(
            "LLM not configured: OPENROUTER_API_KEY and LLM_MODEL must be set"
        )

    if api_key == "test-key-for-testing":
        from .llm.fake import FakeLLMClient
        return FakeLLMClient()

    return OpenRouterClient(api_key=api_key, model=model)


def _narrate_with_grounding_retry(
    client: LLMClient,
    tracker: CostTracker,
    messages: list[Message],
    facts_or_metrics: Any,
    events: list | None = None,
) -> str:
    """Run LLM narration with grounding check and one corrective retry."""
    from .handler import TerminalJobError

    if events is None:
        events = []

    for attempt in (1, 2):
        try:
            response = tracker.call(
                client, "narrate", messages, max_tokens=300, json_mode=True
            )
            reply = json.loads(response.text)
            narrative_text = reply.get("narrative", "")
        except (json.JSONDecodeError, KeyError, TypeError) as exc:
            if attempt == 1:
                bad_reply = response.text if hasattr(response, 'text') else str(exc)
                messages = messages + [
                    Message("assistant", bad_reply[:2000]),
                    Message(
                        "user",
                        "[step:narrate] Your previous reply could not be parsed. "
                        "Reply with ONLY the JSON object: {\"narrative\": \"<your text>\"}",
                    ),
                ]
                continue
            raise TerminalJobError(
                "LLM output remained invalid after corrective retry"
            ) from exc

        passed, reason = check_grounding(narrative_text, facts_or_metrics, events)
        if not passed:
            if attempt == 1:
                messages = messages + [
                    Message("assistant", narrative_text),
                    Message(
                        "user",
                        f"[step:narrate] Your narrative {reason}. "
                        "Revise to use ONLY numbers from the facts and avoid investment advice.",
                    ),
                ]
                continue
            raise TerminalJobError(f"Grounding check failed after retry: {reason}")

        return narrative_text

    raise TerminalJobError("Narration retry exhausted")


def _handle_technical_job(
    raw_envelope: dict,
    artifact_store: ArtifactStore,
    report_progress: ProgressReporter,
    backend_client: BackendClient,
) -> JobResult:
    """TA handler: validate → fetch reference → assemble facts → narrate → post-check → claim-check."""
    from .handler import TerminalJobError

    try:
        envelope = TechnicalJobEnvelope.model_validate(raw_envelope)
    except ValidationError as exc:
        raise TerminalJobError(f"Envelope failed contract validation: {exc}") from exc

    correlation_id = str(envelope.correlationId)
    log = get_logger(__name__, correlation_id=correlation_id)
    symbol = envelope.payload.symbol
    timeframe = envelope.payload.timeframe

    as_of_bucket = envelope.asOf.astimezone(timezone.utc).strftime("%Y-%m-%dT%H")
    job_id = f"technical:{symbol}:{timeframe}:{as_of_bucket}"
    log.info("job.start", extra={"jobId": job_id, "jobName": JOB_ANALYZE_TECHNICAL, "symbol": symbol})

    total = 6
    report_progress(_progress(0, total, "queued", "Queued"))
    report_progress(_progress(1, total, "fetching-market-data", f"Fetching data for {symbol}"))

    try:
        reference = backend_client.get_analysis_reference(symbol)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise TerminalJobError(
                f"Unknown symbol {symbol!r} (backend returned 404)"
            ) from exc
        raise

    if not reference.get("technical"):
        raise TerminalJobError(f"Empty or missing technical facts for {symbol}")

    report_progress(_progress(2, total, "computing-indicators", "Computing indicators"))

    technical = reference["technical"]
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

    events_raw = reference.get("technicalEvents", [])
    events = [
        TechnicalEvent(
            id=e.get("id"),
            label=e.get("label", ""),
            fired=e.get("fired", False),
            values=e.get("values", {}),
            at=e.get("at"),
        )
        for e in events_raw
    ]

    report_progress(_progress(3, total, "synthesizing-verdict", "Synthesizing verdict"))

    facts_dict = technical_facts.model_dump(mode="json")
    events_list = [e.model_dump(mode="json") for e in events]

    headline = generate_ta_headline(facts_dict, events_list)
    narrative_text = headline

    client = _get_llm_client()
    tracker = CostTracker(
        model=client.model,
        ceiling_usd=0.10,
        price_table=DEFAULT_PRICE_TABLE,
    )

    try:
        messages = build_ta_messages(symbol, timeframe, facts_dict, events_list)
        narrative_text = _narrate_with_grounding_retry(
            client, tracker, messages, facts_dict, events_list
        )
        headline = generate_ta_headline(facts_dict, events_list)
    except CostCeilingExceeded:
        narrative_text = "Narrative withheld: narration stopped by cost guard."
        headline = "facts-only: Narration stopped by cost guard."

    artifact = {
        "schemaVersion": SCHEMA_VERSIONS['technical'],
        "symbol": symbol,
        "jobName": JOB_ANALYZE_TECHNICAL,
        "asOf": envelope.asOf,
        "timeframe": timeframe,
        "facts": facts_dict,
        "events": events_list,
        "narrative": {
            "language": "en",
            "text": narrative_text,
        },
        "provenance": {
            "source": "real",
            "adapter": "yfinance",
            "model": client.model,
            "generatedAt": _now(),
        },
        "cost": tracker.report(),
    }

    try:
        TechnicalAnalysisArtifact.model_validate(artifact)
    except ValidationError as exc:
        raise TerminalJobError(
            f"Technical artifact failed contract validation: {exc}"
        ) from exc

    key_suffix = f"technical/{symbol}/{as_of_bucket}.json"
    pointer = artifact_store.put_artifact(key_suffix, artifact)
    report_progress(_progress(4, total, "persisting-artifact", "Persisting artifact"))
    log.info(
        "job.artifact_written",
        extra={"jobId": job_id, "bucket": pointer.bucket, "key": pointer.key},
    )

    result = JobResult(
        correlationId=envelope.correlationId,
        jobId=job_id,
        pointer=pointer,
        summary=SystemSummary(headline=headline, asOf=envelope.asOf),
        at=_now(),
    )
    report_progress(_progress(5, total, "done", "Done"))
    log.info("job.done", extra={"jobId": job_id})
    return result


def _handle_fundamental_job(
    raw_envelope: dict,
    artifact_store: ArtifactStore,
    report_progress: ProgressReporter,
    backend_client: BackendClient,
) -> JobResult:
    """FA handler: validate → fetch reference → assemble metrics → narrate → post-check → claim-check."""
    from .handler import TerminalJobError

    try:
        envelope = FundamentalJobEnvelope.model_validate(raw_envelope)
    except ValidationError as exc:
        raise TerminalJobError(f"Envelope failed contract validation: {exc}") from exc

    correlation_id = str(envelope.correlationId)
    log = get_logger(__name__, correlation_id=correlation_id)
    symbol = envelope.payload.symbol
    period = envelope.payload.period

    if period == 'annual':
        raise TerminalJobError('Annual period not yet supported')

    as_of_bucket = envelope.asOf.astimezone(timezone.utc).strftime("%Y-%m-%dT%H")
    job_id = f"fundamental:{symbol}:{period}:{as_of_bucket}"
    log.info("job.start", extra={"jobId": job_id, "jobName": JOB_ANALYZE_FUNDAMENTAL, "symbol": symbol})

    total = 6
    report_progress(_progress(0, total, "queued", "Queued"))
    report_progress(_progress(1, total, "fetching-financials", f"Fetching financials for {symbol}"))

    try:
        reference = backend_client.get_analysis_reference(symbol)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise TerminalJobError(
                f"Unknown symbol {symbol!r} (backend returned 404)"
            ) from exc
        raise

    if not reference.get("fundamental", {}).get("metrics"):
        raise TerminalJobError(f"Empty or missing fundamental metrics for {symbol}")

    report_progress(_progress(2, total, "computing-metrics", "Computing metrics"))

    metrics_raw = reference.get("fundamental", {}).get("metrics", [])
    if len(metrics_raw) != 9:
        raise TerminalJobError(
            f"Expected 9 fundamental metrics, got {len(metrics_raw)}"
        )

    metrics = [
        FundamentalMetric(
            id=m.get("id"),
            label=m.get("label", ""),
            value=m.get("value"),
            unit=m.get("unit", ""),
            asOf=m.get("asOf"),
        )
        for m in metrics_raw
    ]

    report_progress(_progress(3, total, "synthesizing-verdict", "Synthesizing verdict"))

    metrics_list = [m.model_dump(mode="json") for m in metrics]

    headline = generate_fa_headline(metrics_list)
    narrative_text = headline

    client = _get_llm_client()
    tracker = CostTracker(
        model=client.model,
        ceiling_usd=0.10,
        price_table=DEFAULT_PRICE_TABLE,
    )

    try:
        messages = build_fa_messages(symbol, period, metrics_list)
        narrative_text = _narrate_with_grounding_retry(
            client, tracker, messages, metrics_list
        )
        headline = generate_fa_headline(metrics_list)
    except CostCeilingExceeded:
        narrative_text = "Narrative withheld: narration stopped by cost guard."
        headline = "facts-only: Narration stopped by cost guard."

    artifact = {
        "schemaVersion": SCHEMA_VERSIONS['fundamental'],
        "symbol": symbol,
        "jobName": JOB_ANALYZE_FUNDAMENTAL,
        "asOf": envelope.asOf,
        "period": period,
        "metrics": metrics_list,
        "narrative": {
            "language": "en",
            "text": narrative_text,
        },
        "provenance": {
            "source": "real",
            "adapter": "yfinance",
            "model": client.model,
            "generatedAt": _now(),
        },
        "cost": tracker.report(),
    }

    try:
        FundamentalAnalysisArtifact.model_validate(artifact)
    except ValidationError as exc:
        raise TerminalJobError(
            f"Fundamental artifact failed contract validation: {exc}"
        ) from exc

    key_suffix = f"fundamental/{symbol}/{as_of_bucket}.json"
    pointer = artifact_store.put_artifact(key_suffix, artifact)
    report_progress(_progress(4, total, "persisting-artifact", "Persisting artifact"))
    log.info(
        "job.artifact_written",
        extra={"jobId": job_id, "bucket": pointer.bucket, "key": pointer.key},
    )

    result = JobResult(
        correlationId=envelope.correlationId,
        jobId=job_id,
        pointer=pointer,
        summary=SystemSummary(headline=headline, asOf=envelope.asOf),
        at=_now(),
    )
    report_progress(_progress(5, total, "done", "Done"))
    log.info("job.done", extra={"jobId": job_id})
    return result
