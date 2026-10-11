# PoC / Phase A Worker Spec — Technical & Fundamental Analysis Handoff

Label: `spec`
Status: ready-for-agent

## Problem Statement

The PoC placeholder TA/FA handlers (ADR-0003 stub) produce synthetic verdicts
with no real facts or narratives. Real TA/FA logic stays out of scope (indicator
computation is a later feature effort), but **real narration on code-verified
facts** is needed for the PoC to be usable.

This spec pins the PoC TA/FA job handlers for `analyze-technical` and
`analyze-fundamental`:

1. **Fact assembly** — fetch code-verified indicators, metrics, and events from
   the backend via a new worker-facing reference read
2. **Narration** — prompt an LLM to describe the facts (OpenRouter, Gemini 2.5
   Flash)
3. **Grounding** — post-check the narrative for number accuracy and advice bans
4. **Cost guard** — per-job spend ceiling ($0.10 USD)
5. **Facts-only fallback** — surface facts to users even when narrative fails

### Scope of work

- **Inside scope:** fact assembly reference read (worker-side design + contract),
  TA/FA handlers (flat functions, no LangGraph), narration prompts + retry,
  grounding post-check, cost tracking, facts-only signal
- **Outside scope:** real TA/FA indicator computation (later feature effort),
  BE reference endpoint implementation (named follow-on), FE display logic (FE map),
  BM support (dropped for PoC)

### Constraints

- **Artifact shapes** (locked): `TechnicalAnalysisArtifact` / `FundamentalAnalysisArtifact`
  with 9 FA metrics, non-empty `AnalysisNarrative.text`, `SystemSummary` only
  (no verdict), `ProspectusCostReport` cost block
- **Envelope payloads** (locked): TA = `{symbol, timeframe: "1D"}`,
  FA = `{symbol, period: "quarterly"}`; no facts ride the queue
- **JobId minting** (locked): colon forms `technical:{symbol}:1D:{asOfBucket}` /
  `fundamental:{symbol}:quarterly:{asOfBucket}`
- **Backend is stateless reader** (ADR-0004): never queries Postgres directly;
  all context fetched via NestJS reads

---

## Solution: Flat handlers + reference read + narration + post-check

### Architecture

```
envelope (symbol + timeframe/period)
    ↓
validate envelope (runtime conformance)
    ↓
fetch facts from backend reference endpoint (GET /stocks/:code/analysis/reference)
    ↓
check facts not empty → terminal failure if so
    ↓
assemble facts + events into JSON
    ↓
call LLM with facts: generate narrative (first attempt + corrective retry if malformed)
    ↓
post-check narrative:
    - number containment (every number must match the facts)
    - ban words (no buy/sell/hold, targets, advice-shaped language)
    - on violation → strip to deterministic placeholder + signal "facts-only"
    ↓
build artifact (facts, events, narrative, provenance, cost block)
    ↓
pre-write validation (Pydantic contract check)
    ↓
claim-check to S3, return JobResult
```

No LangGraph machinery (issue 02 resolved to flat functions). All TA/FA steps
are fast (no heartbeat). Only one retry: corrective LLM call on malformed output.

### 1. Fact assembly: reference read contract

**Worker-side usage:**

```python
reference = backend_client.get_analysis_reference(symbol)

# TA reference block:
reference["technical"] = {
    "sma": {"p20": 123.45, "p50": 124.1, "p200": 125.3},
    "rsi": {"period": 14, "value": 72.5},
    "macd": {"line": 0.85, "signal": 0.78, "histogram": 0.07},
    "week52": {"high": 150.2, "low": 98.5},
    "latestClose": 140.3,
}

# TA events block (computed TS-side on-read from stored bars):
reference["technicalEvents"] = [
    {
        "id": "rsi_band",
        "label": "RSI entered overbought territory (> 70)",
        "fired": true,
        "values": {"rsi_level": 72.5},
        "at": "2026-10-10"
    },
    ...
]

# FA reference block:
reference["fundamental"] = {
    "metrics": [
        {"id": "trailing_pe", "label": "P/E ratio (trailing)", "value": 12.5, "unit": "x", "asOf": "2026-10-10"},
        {"id": "dividend_yield", "label": "Dividend yield", "value": 3.2, "unit": "%", "asOf": "2026-10-10"},
        ...
    ],
}

# Shared identity + EOD anchor:
reference["code"] = "1155"
reference["shortName"] = "Maybank"
reference["latestCloseDay"] = "2026-10-10"  # the asOf coherence anchor for metrics
reference["asOfDatetime"] = "2026-10-10T18:00:00Z"  # full ISO datetime
```

**Backend implementation** (named follow-on, not in this spec):

- Endpoint: `GET /stocks/:code/analysis/reference` (anonymous, KLCI-30 gate)
- Response shape: backend-local Zod (not in `@tuju/contracts`)
- TA events: computed on read from stored EOD bar history (CONTEXT.md "recompute on demand" precedent)
- FA metrics: house-computed ratios (P/E, D/E, ROE, DY) + quarterly growth + additive yfinance `financialData` OCF fetch

### 2. Handler shape: flat functions, no LangGraph

Both handlers follow the same linear pattern as market brief and announcement summary
(not the prospectus's multi-step LLM flow). Implement two new functions in
`services/ai/src/tuju_ai/handler.py`:

```python
def _handle_technical_job(
    raw_envelope: dict,
    artifact_store: ArtifactStore,
    report_progress: ProgressReporter,
    backend_client: BackendClient,
) -> JobResult:
    """TA handler: validate → fetch reference → assemble facts → narrate → post-check → claim-check."""
    # ... implementation (see Implementation section)

def _handle_fundamental_job(
    raw_envelope: dict,
    artifact_store: ArtifactStore,
    report_progress: ProgressReporter,
    backend_client: BackendClient,
) -> JobResult:
    """FA handler: validate → fetch reference → assemble metrics → narrate → post-check → claim-check."""
    # ... implementation (see Implementation section)
```

Replace the current `_handle_analysis_job` call-to-stub with dispatches to these.

**Progress steps** (locked phases from contracts):

- TA: `queued` → `fetching-market-data` → `computing-indicators` → `synthesizing-verdict` → `persisting-artifact` → `done`
- FA: `queued` → `fetching-financials` → `computing-metrics` → `synthesizing-verdict` → `persisting-artifact` → `done`

No heartbeat (all steps are fast).

### 3. Narration: OpenRouter prompt + corrective retry

**Default model:** `google/gemini-2.5-flash` (override via `LLM_MODEL` env)

**Prompt templates** (issue 03 resolved):

See **Appendix: Prompt Templates** below for the full TA and FA system + user prompts.

**Retry logic:**

1. Call LLM with facts JSON inline + prompt (issue 03)
2. Parse response as JSON, validate Pydantic model
3. If malformed (JSON parse error or validation failure):
   - Echo up to 2000 chars of the bad response
   - Append corrective instruction: `"This JSON was invalid. Retry with valid JSON that includes the 'narrative' field: <snippet>"`
   - Resend (same system prefix for cache benefit)
   - Parse + validate second response
4. If still malformed → `MalformedModelOutput` → `TerminalJobError`

**No second retry round.** One corrective attempt, then fail.

**Word count:** soft (prompt instruction ~80–150 words, not post-check enforced)

### 4. Grounding post-check: numbers + bans (issue 04 resolved)

**Number check algorithm:**

1. Extract all numerals from the narrative using regex:
   `r'(?:RM)?[\d,]+\.?\d*\s*%?|[\d.]+%|[\d,]+(?:\.\d+)?'`
2. Normalize each (strip spaces/commas, pad decimals):
   - `"70%"` → `"70"`
   - `"123.45"` → `"123.45"` or `"123"` (check both)
   - `"RM1.2b"` → extract numeric portion
3. For each normalized number, check for verbatim match in:
   - Fact payload fields (SMA, RSI value, MACD line, Week52 high/low, latest close, metric values)
   - Event `values` dicts
4. If any number has no match → `GroundingViolation`

**Ban word check:**

List: `["buy", "sell", "hold", "target", "price target", "undervalued", "overvalued", "underweight", "overweight", "recommendation", "recommend", "advise", "should invest", "should buy"]`

Matching: case-insensitive substring search. If found → `GroundingViolation`.

**Violation handling:**

1. First violation (after LLM call) → trigger corrective retry (from narration step)
2. Second violation (after corrective LLM call still produces bad narrative):
   - Strip narrative to placeholder: `"Narrative withheld: failed the grounding check."`
   - Generate headline prefix: `"facts-only: Grounding check failed."`
   - Artifact still written with facts + placeholder + cost
   - Job completes with `facts_only` signal (issue 05)

**Cost ceiling exceeded** (issue 06):

Same strip path: `"facts-only: Narration stopped by cost guard."`

### 5. `facts_only` signal: headline prefix (issue 05 resolved)

**Signal convention:**

- **Normal ready:** `headline = "RSI 72; price above all SMAs"` (deterministic code, top event or key metric)
- **Grounding or cost strip:** `headline = "facts-only: <reason>"` (e.g., `"facts-only: Grounding check failed."`)

**Empty facts path:** `TerminalJobError` (fail before LLM call; not facts_only)

**BE hook follow-on** (consumer section):

```typescript
const headline = jobResult.summary.headline;
if (headline.startsWith("facts-only: ")) {
  // Upsert status = "facts_only"
} else {
  // Upsert status = "ready"
}
```

### 6. Cost tracking: $0.10 ceiling (issue 06 resolved)

**Per-job ceiling:** $0.10 USD

**Rationale:** ~60× single-call cost, safe for one corrective retry

**Nightly worst case:** 60 jobs × $0.10 = $6 maximum

**CostTracker usage:**

```python
tracker = CostTracker(
    model=client.model,
    ceiling_usd=0.10,
    price_table=llm.cost.DEFAULT_PRICE_TABLE,
)

response = tracker.call(
    client,
    step="narrate",
    messages=[...],
    max_tokens=300,  # for ~200-word output
)

# On CostCeilingExceeded: strip narrative (same as grounding violation)

# Populate artifact cost block:
artifact["cost"] = tracker.report()
```

---

## Implementation decisions

### Failure classes (ADR-0007 §6)

**Terminal (TerminalJobError → BullMQ UnrecoverableError):**

- Bad envelope (ValidationError)
- Unknown symbol / 404 reference endpoint → `httpx.HTTPStatusError` status_code == 404
- Malformed reference response (ValidationError on reference decode)
- **Empty facts** (check after reference fetch; see fact assembly contract)
- Malformed LLM output after corrective retry → `MalformedModelOutput`
- Grounding violation after corrective retry → `GroundingViolation`
- Cost ceiling exceeded → `CostCeilingExceeded` (but strip instead of fail; emit facts_only)

**Transient (reraise, BullMQ retries with backoff):**

- Backend 5xx (on reference fetch)
- LLM timeout / rate-limit / 5xx
- Network blips

**Pattern:** catch `httpx.HTTPStatusError`, branch on 404 → terminal, reraise otherwise.

### JobId minting

```python
job_prefix = "technical" if job_name == JOB_ANALYZE_TECHNICAL else "fundamental"
anchor_value = envelope.payload.timeframe if job_name == JOB_ANALYZE_TECHNICAL else envelope.payload.period
as_of_bucket = envelope.asOf.astimezone(timezone.utc).strftime("%Y-%m-%dT%H")
job_id = f"{job_prefix}:{symbol}:{anchor_value}:{as_of_bucket}"
```

Examples:
- Technical: `technical:1155:1D:2026-10-10T18`
- Fundamental: `fundamental:1155:quarterly:2026-10-10T18`

### Artifact key layout

- TA: `analysis/technical/{symbol}/{asOfBucket}.json`
- FA: `analysis/fundamental/{symbol}/{asOfBucket}.json`

Symmetric with jobId; BE hook + proxy read via `JobResult.pointer`, not path.

### Headline generation (deterministic, no LLM)

**TA:**

1. If any event fired → `event.label` of first fired
2. Else → key metric summary: e.g., `"RSI 72, above all SMAs"` or `"Price 4.2% below 52-week high"`
3. Fallback: `"Data unavailable for analysis"`

**FA:**

1. If any metric non-null → most compelling: e.g., `"P/E 12.5x, below average"` or `"Revenue 15% YoY"`
2. Fallback: `"Data unavailable for analysis"`

### Artifact population

```python
artifact = {
    "schemaVersion": "technical-analysis-1",  # or "fundamental-analysis-1"
    "symbol": symbol,
    "jobName": job_name,
    "asOf": envelope.asOf,
    "timeframe": "1D",  # TA only
    "period": "quarterly",  # FA only
    "facts": facts,  # TechnicalFacts or list[FundamentalMetric]
    "events": events,  # list[TechnicalEvent]
    "narrative": narrative,  # AnalysisNarrative with "facts-only: " prefix if stripped
    "provenance": AnalysisProvenance(
        source="real",
        adapter="yfinance",
        model=client.model,  # effective model id after env resolution
        generatedAt=datetime.now(timezone.utc),
    ),
    "cost": tracker.report(),  # ProspectusCostReport from CostTracker
}

# Pre-write validation
TechnicalAnalysisArtifact.model_validate(artifact)  # or Fundamental...

# Claim-check
pointer = artifact_store.put_artifact(key_suffix, artifact)
```

---

## Testing strategy (ADR-0011)

### Unit tests (`pytest.mark.unit`)

- FakeLLMClient (already exists in `llm/fake.py`)
- FakeBackendClient for reference endpoint (same pattern as existing tests)
- FakeS3 (already exists)
- No network, no Docker
- Coverage:
  - Happy path TA + FA (contract-valid JobResult, correct jobId, artifact written under correct prefix)
  - Bad envelope → TerminalJobError
  - 404 reference → TerminalJobError
  - Empty facts → TerminalJobError
  - Malformed reference response → TerminalJobError
  - Bad LLM output → TerminalJobError after corrective retry
  - Grounding violation → TerminalJobError after corrective retry
  - Cost ceiling exceeded → artifact written with facts_only signal (not terminal)
  - Progress sequence: stepIndex 0→5 monotonic, phases match locked enum

### Contract golden fixtures

**Already exist / already passing (per issue 02):**
- `job-result-technical-system.json` (TA JobResult)
- `job-result-fundamental-system.json` (FA JobResult)
- `technical-analysis-artifact.json`
- `fundamental-analysis-artifact.json`

**Conformance check:** validate these fixtures against Zod + Pydantic (contracts tests + worker tests)

### Integration layer (`pytest.mark.integration`)

- Testcontainers Redis + LocalStack
- Real BullMQ enqueue → Python worker → `completed` event
- Check S3 artifact present + contract-valid + headline prefix handling (facts_only signal)
- Skippable until BE reference endpoint ships real fixtures

---

## Consumers (BE follow-ons)

Named follow-ons (not in worker spec execution, but dependencies for the full pipeline):

1. **Reference endpoint** (`GET /stocks/:code/analysis/reference`):
   - Backend-local Zod shape (not in contracts)
   - Anonymous, KLCI-30-gated
   - TA block: SMA/RSI/MACD/week52 facts + latest close
   - FA block: 9 metrics (P/E, DY, ROE, D/E, QoQ/YoY growth, OCF)
   - Identity + EOD anchor: code, shortName, latestCloseDay, asOfDatetime

2. **TA event detection** (in reference endpoint):
   - The 7 TechnicalEventIds computed TS-side on-read from stored EOD bars
   - Same math as `indicators.ts` family
   - Event rows: id, label, fired (bool), values (dict), at (date)

3. **FA OCF ingest** (if chosen as per issue 01 answer):
   - Extend `YFinanceFundamentalsAdapter` with `financialData` module (or cash-flow time series)
   - Populate operating_cash_flow metric in the reference endpoint
   - Cache yfinance response (existing pattern)

4. **Hook facts_only mapping** (technical-analysis.store.ts + fundamental-analysis.store.ts):
   - Pattern-match `headline.startsWith("facts-only: ")`
   - Upsert `status = "facts_only"` vs `"ready"`
   - No new fields; existing schema sufficient

---

## Out of scope

- Real TA/FA indicator/metric computation (later feature effort)
- FE display logic, chart overlays, card layout (FE map)
- BM narrative (dropped for PoC; `language: "en"` only)
- Per-user job triggers, verdicts, watchlist, alerts (later feature effort)
- Global nightly spend tracker (per-job `CostTracker` only for PoC)
- Public-launch licensing / yfinance purge

---

## Acceptance criteria

✓ Fact assembly reference read (worker-side contract) is defined and consumable
✓ Two flat handlers (`_handle_technical_job`, `_handle_fundamental_job`) replace the stub
✓ LLM narration with corrective retry is wired (OpenRouter, Gemini Flash)
✓ Grounding post-check (numbers + bans) strips violations to deterministic placeholder
✓ `facts_only` signal via headline prefix is generated and consumable by BE hook
✓ Cost tracking with $0.10 ceiling is enforced; ceiling exceeded → facts_only strip
✓ All unit tests pass (happy path + failure cases)
✓ Contract golden fixtures validate
✓ Artifact schema version updated + examples match (technical-analysis-1, fundamental-analysis-1)
✓ jobId colon forms are minted correctly (technical:symbol:1D:bucket, fundamental:symbol:quarterly:bucket)
✓ Handler progress sequence matches locked enum (6 steps: queued → done)

---

## Appendix: Prompt Templates

### Technical Analysis Prompt

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

**User template:**

```
Analyze the following technical data for {SYMBOL} on the {TIMEFRAME} timeframe.

Respond with valid JSON:

{
  "narrative": "<your narrative here>"
}

Technical facts packet:
{
  "sma": {
    "p20": {SMA_20_VALUE},
    "p50": {SMA_50_VALUE},
    "p200": {SMA_200_VALUE}
  },
  "rsi": {
    "period": 14,
    "value": {RSI_VALUE}
  },
  "macd": {
    "line": {MACD_LINE},
    "signal": {MACD_SIGNAL},
    "histogram": {MACD_HISTOGRAM}
  },
  "week52": {
    "high": {WEEK52_HIGH},
    "low": {WEEK52_LOW}
  },
  "latestClose": {LATEST_CLOSE}
}

Fired events (technical signals):
{EVENTS_JSON}

Example events:
[
  {
    "id": "rsi_band",
    "label": "RSI entered overbought territory (> 70)",
    "fired": true,
    "at": "2026-10-10"
  },
  {
    "id": "ma_cross_20_50",
    "label": "20-day MA crossed above 50-day MA",
    "fired": true,
    "at": "2026-10-08"
  }
]

Instructions:
- Use ONLY numbers present in the facts or events above.
- If a value is null, explicitly state the absence (e.g., "RSI data unavailable").
- Describe price location, trend direction, and pattern matches.
- Do not make up numbers or compute new metrics.
```

### Fundamental Analysis Prompt

**System:**

```
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
```

**User template:**

```
Analyze the following fundamental data for {SYMBOL} ({PERIOD} period).

Respond with valid JSON:

{
  "narrative": "<your narrative here>"
}

Fundamental metrics:
{
  "metrics": {METRICS_JSON}
}

Example metrics:
[
  {
    "id": "trailing_pe",
    "label": "P/E ratio (trailing)",
    "value": 12.5,
    "unit": "x",
    "asOf": "2026-10-10"
  },
  {
    "id": "dividend_yield",
    "label": "Dividend yield",
    "value": 3.2,
    "unit": "%",
    "asOf": "2026-10-10"
  },
  {
    "id": "revenue_growth_yoy",
    "label": "Revenue growth (YoY)",
    "value": 15.0,
    "unit": "%",
    "asOf": "2026-10-10"
  },
  {
    "id": "operating_cash_flow",
    "label": "Operating cash flow",
    "value": null,
    "unit": "RM bn",
    "asOf": "2026-10-10"
  }
]

Instructions:
- Use ONLY numbers and metrics present in the list above.
- If a value is null, explicitly state the absence (e.g., "Operating cash flow data unavailable").
- Describe profitability, growth trends, valuation relative to history, and financial health.
- Do not make up numbers or compute new metrics.
```

---

## Related documents

- **Parent spec:** [PoC / Phase A overarching](../poc-phase-a/spec.md)
- **Contracts:** [PoC Phase A contracts](../poc-phase-a-contracts/spec.md)
- **Backend handoff:** [backend spec](../poc-phase-a-backend/spec.md) + [build map](../poc-phase-a-backend-build/map.md)
- **Planning tickets:** [issues/](issues/)
- **Worker context:** `services/ai/CONTEXT.md`
- **System ADRs:** `docs/adr/` (esp. ADR-0001, 0003, 0004, 0007, 0011, 0014)
