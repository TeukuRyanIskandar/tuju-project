# Decide: OpenRouter narrative prompt + policy

Type: grilling
Status: resolved
Blocked by: 02

## Question

Parent locks: reuse the OpenRouter client seam; default model
`google/gemini-2.5-flash` (override `LLM_MODEL`; free-route models allowed);
plain language; ~80–150 words; hard bans on buy/sell/hold, targets,
advice-shaped valuation calls; facts-only prompt (narrative may use only
numbers/events present in the fact payload); skip LLM entirely when facts
are empty; `language: 'en'` (BM dropped at the contracts map).

1. Prompt text: pin the actual TA and FA prompt templates — system framing
   ("describe what the data shows; never advise"), user message with the
   fact packet JSON inline, word-count instruction, and how null metrics
   must be handled (state absence in plain words, never guess or compute new
   numbers).
2. Malformed-output policy: one deterministic retry with a corrective append
   (the prospectus `MalformedModelOutput` pattern) vs immediate
   facts-only strip on the first malformed response?
3. `AnalysisProvenance.model` = the effective LLM model id used (the
   `LLM_MODEL` resolution), so provenance records the actual narrator?
4. Word count: soft (prompt instruction only) vs hard (post-check rejects
   >150 words like a number violation — interacts with ticket 04)?
5. Does the prompt get the event **labels** (contract English labels) as
   narrative anchors, and is the LLM told the audience is a private demo
   panel (no disclaimer language in the narrative)?

Fixed inputs: parent spec LLM section; `AnalysisNarrative` /
`AnalysisProvenance` shapes (locked); `llm/` seam (OpenRouter via httpx).

## Answer

### 1. Malformed-output policy: one corrective retry

Mirror the prospectus pattern (`services/ai/src/tuju_ai/prospectus/analysis.py`
lines 188–206). On first malformed output:

1. Echo up to 2000 chars of the bad reply
2. Append a corrective instruction (e.g., "This JSON was invalid. Retry with
   valid JSON that includes the `narrative` field.")
3. Resend with the same system + prefix (shared-prefix-first for cache benefit)
4. On second failure, raise `MalformedModelOutput` → `TerminalJobError`

**Assumption:** LLM responses are always JSON (validated by Pydantic). Badly
formatted JSON or missing fields triggers the retry.

### 2. Word count: soft (prompt instruction only)

The prompt instructs ~80–150 words; no post-check rejection. If the narrative
exceeds the range, it is still processed. The word-count constraint comes from:

- **Effective limit:** Ticket 06's cost ceiling ($0.10/job) naturally constrains
  output token budget.
- **Prompt guidance:** The user message includes "Keep your narrative concise,
  approximately 80–150 words" as a soft instruction.
- **Post-check focuses on quality:** Ticket 04's grounding (numbers + bans) is
  the hard enforcement; word count is secondary.

### 3. `AnalysisProvenance.model`: the effective model id

Set `provenance.model` to the **resolved** LLM model id at job time:

```python
provenance = AnalysisProvenance(
    source="real",
    adapter="yfinance",
    model=client.model,  # LLMClient.model: the effective model after env resolution
    generatedAt=datetime.now(timezone.utc),
)
```

This way, if `LLM_MODEL` env overrides the default, the artifact provenance
records which model actually narrated it.

### 4. Event labels in the prompt

Yes, the prompt receives the contract English labels for the fired events.
Example TA event label (from `TechnicalEvent`): "Price crossed above 50-day
moving average" or "RSI entered overbought territory (> 70)".

The user message includes the event list with labels so the LLM can reference
them as narrative anchors.

### 5. Audience context

The system prompt frames the audience as a **private demo panel** — no
disclaimer language (e.g., "Not investment advice"). The tone is direct,
illustrative, and educational.

---

### Prompt templates (TA and FA)

#### TA Prompt

**System:**

```
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
```

**User:**

```
Analyze the following technical data for {symbol} on the {timeframe} timeframe.
Respond with JSON:

{
  "narrative": "<your 80–150 word narrative here>"
}

Technical facts:
{
  "sma": {
    "p20": {float or null},
    "p50": {float or null},
    "p200": {float or null}
  },
  "rsi": {
    "period": 14,
    "value": {float or null}
  },
  "macd": {
    "line": {float or null},
    "signal": {float or null},
    "histogram": {float or null}
  },
  "week52": {
    "high": {float},
    "low": {float}
  },
  "latestClose": {float}
}

Fired events (technical patterns):
{
  "events": [
    {
      "id": "{event_id}",
      "label": "{event label in plain English}",
      "fired": true,
      "at": "{date}"
    },
    ...
  ]
}

Remember: describe what the data shows. Use only the numbers above. If a metric
is null, state the absence.
```

#### FA Prompt

**System:**

```
You are a fundamental analyst tasked with describing what the financial data
shows for a stock, without offering investment advice.

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
growth rates, leverage, and valuation relative to historical ranges.
```

**User:**

```
Analyze the following fundamental data for {symbol} ({period} period).
Respond with JSON:

{
  "narrative": "<your 80–150 word narrative here>"
}

Fundamental metrics:
{
  "metrics": [
    {
      "id": "{metric_id}",
      "label": "{metric label in plain English}",
      "value": {float or null},
      "unit": "{unit string, e.g. '%', 'x', 'RM bn'}",
      "asOf": "{date}"
    },
    ...
  ]
}

Metrics include:
- Valuation: P/E, dividend yield, ROE, debt-to-equity
- Growth: QoQ/YoY revenue and profit growth
- Cash flow: Operating cash flow (may be null)

Remember: describe what the data shows. Use only the numbers above. If a metric
is null, state the absence.
```

---

### Implementation (build pass)

Tickets 01 (fact assembly reference read) and 03 (prompting) are independent:

- **Ticket 01** assembles facts and returns them (no narration yet)
- **Ticket 03** (this ticket) wires the LLM call into the handler, assembles
  the narrative using the prompts above, and implements the corrective retry

The two combine in the full TA/FA handler flow.
