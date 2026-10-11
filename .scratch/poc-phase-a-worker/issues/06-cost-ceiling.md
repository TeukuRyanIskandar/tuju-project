# Decide: per-job cost ceiling + nightly budget

Type: grilling
Status: resolved
Blocked by: 03

## Question

Parent: "Cost bound by 30×2 nightly jobs; soft ceiling per job (worker spec
pins $)." Prospectus prior art: `CostTracker` ceiling ~$2/doc, terminal on
exceed, `ProspectusCostReport` reused as the artifact `cost` block (Nest
strips it on the HTTP proxy).

1. Per-job ceiling USD for one short narration (fact packet in, ≤200 words
   out) on the default `google/gemini-2.5-flash` (and free-route models when
   `LLM_MODEL` overrides): e.g. $0.10? Pin the number + rationale + headroom
   for the one retry allowed by ticket 03.
2. Nightly bound: 60 jobs × ceiling = the documented worst case (state it);
   per-job `CostTracker` only (PoC) vs any global nightly tracker?
3. `cost` block on TA/FA artifacts: populate `ProspectusCostReport` from
   `CostTracker` exactly the prospectus way (locked in contracts — confirm
   the population path)?
4. Ceiling-exceeded class: terminal failure (mirror prospectus) vs
   facts-only strip (the facts are already good; only wording is at
   stake) — and does the answer change for the empty-facts path?

Fixed inputs: parent spec; `ProspectusCostReport` on both artifacts
(locked); `llm/` `CostTracker` prior art.

## Answer

### 1. Per-job ceiling: $0.10 USD

**Rationale:**

- **Baseline cost for one call** (Gemini 2.5 Flash):
  - Input: ~1K tokens (fact payload JSON + system prompt) at $0.30/M = $0.0003
  - Output: ~200 tokens (narrative) at $2.50/M = $0.0005
  - Total per call ≈ $0.0008
  
- **One corrective retry** (ticket 03):
  - Same magnitude, so 2× ≈ $0.0016 total

- **Safety headroom** (provider variance, model changes, price drift):
  - Ceiling at $0.10 = ~60× the expected single-call cost
  - Ample buffer for any single call overrunning (cache misses, etc.)

- **60 jobs nightly** = $0.10 × 60 = **$6 worst case**
  - Acceptable for the PoC (compare: prospectus $2/doc, but that's parsing + 5 LLM calls)

### 2. Nightly bound: per-job tracker only

**Per-job ceiling:** $0.10 USD (enforced by `CostTracker`)

**Documented nightly worst case:** 60 jobs × $0.10 = $6 maximum

**Global nightly tracker:** not implemented in PoC. The per-job ceiling is
the sole guard. Monitor spend nightly via logs; if real usage approaches
$6/night, adjust the per-job ceiling downward.

**Future extension:** a global nightly tracker can be added in a later pass
(e.g., a Redis counter incremented by each job, checked at enqueue time).

### 3. Cost block population: use `CostTracker.report()`

Populate the artifact's `ProspectusCostReport` field **exactly as prospectus
does** (see `services/ai/src/tuju_ai/prospectus/analysis.py` line 504):

```python
artifact = {
    "schemaVersion": "technical-analysis-1",
    "symbol": symbol,
    "jobName": "analyze-technical",
    "asOf": envelope.asOf,
    "timeframe": "1D",
    "facts": facts,
    "events": events,
    "narrative": narrative,
    "provenance": provenance,
    "cost": tracker.report(),  # CostTracker.report() → ProspectusCostReport
}
```

`CostTracker.report()` returns a dict shaped exactly like `ProspectusCostReport`:

```python
{
    "model": "google/gemini-2.5-flash",
    "calls": 1,
    "promptTokens": 1050,
    "completionTokens": 187,
    "cachedTokens": 0,
    "estimatedCostUsd": 0.00163,
    "ceilingUsd": 0.10,
    "perCall": [
        {
            "step": "narrate",
            "promptTokens": 1050,
            "completionTokens": 187,
            "cachedTokens": 0,
            "costUsd": 0.00163
        }
    ]
}
```

### 4. Ceiling exceeded: facts-only strip (not terminal)

When `CostTracker` raises `CostCeilingExceeded` during the LLM narration call,
the handler **strips the narrative** (same path as a grounding violation from
ticket 04):

```python
try:
    # Ticket 03 calls the LLM and corrective retry
    narrative = narrate_with_retry(facts, client, tracker)
except CostCeilingExceeded as exc:
    log.warning("Cost ceiling exceeded; stripping narrative", extra={"error": str(exc)})
    # Strip: use deterministic placeholder
    narrative = {"language": "en", "text": "Narrative withheld: stopped by cost guard."}
```

The artifact **is still written** with:
- Facts intact
- Events intact
- Placeholder narrative
- Cost block showing the ceiling was breached (`estimatedCostUsd >= ceilingUsd`)
- Headline prefix `"facts-only: Narration stopped by cost guard."` (ticket 05)

**Rationale:** The facts are good and verified. We stopped *before* completing
the expensive call, so we only paid for the partial work. Surface the facts to
the user; withhold the narrative. This is strictly better than failing the job
outright.

**Empty-facts note:** if facts are empty, the job fails with `TerminalJobError`
before any LLM call (ticket 05 question 4), so the cost ceiling is never
checked. A ceiling-exceeded error only happens in the narration step, which is
skipped for empty facts.
