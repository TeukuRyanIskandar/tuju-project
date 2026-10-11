# Decide: `facts_only` wire signal + headline policy

Type: grilling
Status: resolved
Blocked by: 04

## Question

BE build pin: "`facts_only` — column/enum kept; **hook never writes it yet** —
success + `SystemSummary` → `ready`, failure → `failed`; enqueue → `pending`
(+ `running` when observed). Worker map pins the wire signal later." The BE
skip rule already treats `facts_only` as a completed state (same-day skip;
`stale` promotion); the FE status enum has `facts_only` as a first-class
state.

Pin the convention the BE hook will consume (a named follow-on in the spec's
consumer section), **without touching contracts**:

1. Signal carrier: a `SystemSummary.headline` sentinel prefix (e.g.
   `facts-only: …`) that the BE hook pattern-matches vs a `JobResult.jobId`
   marker vs an artifact-path marker vs any other in-shape convention?
2. FE read shape for a facts-only run: thin row carries the sentinel headline
   + artifact pointer; the cost-stripped artifact shows facts/events with the
   deterministic placeholder narrative (ticket 04) — confirmed, or does the
   FE need a distinguishable field-level cue (it already distinguishes by
   status)?
3. Headline policy for normal `ready` runs: deterministic **code** headline
   (top event / key metric — reproducible, no LLM) vs the LLM narrative's
   first sentence vs the LLM writing a dedicated headline (extra output
   field / regex slice)?
4. Empty-facts run (fail-closed before any LLM call): same `facts_only`
   signal as a grounding strip (facts present, narrative stripped) — or
   distinct (e.g. `failed` with a clear `userMessage`, since there are no
   facts to show either)?

Fixed inputs: `SystemSummary` = `{ headline, asOf }` only; BE hook + skip
rule parsing (build map tickets 04/05); FE status enum
`pending | running | ready | facts_only | failed | stale`.

## Answer

### 1. Signal carrier: `SystemSummary.headline` sentinel prefix

The worker signals `facts_only` via the headline prefix: **`"facts-only: "`**

**Convention:**

- **Normal ready** → `headline = "RSI overbought; price above all SMAs"`
- **Grounding strip** → `headline = "facts-only: Grounding check failed on narrative."`
- **Cost ceiling strip** → `headline = "facts-only: Narration stopped by cost guard."`
- **Empty facts** → `TerminalJobError` (see question 4)

**BE hook pattern-match:**

```typescript
// In the jobbus result handler (technical-analysis.store.ts + fundamental-analysis.store.ts)
const headline = jobResult.summary.headline;
if (headline.startsWith("facts-only: ")) {
  // Upsert status = "facts_only"
} else {
  // Upsert status = "ready"
}
```

**Rationale:** Headline already rides the `SystemSummary` (required, non-empty);
adding a prefix is a lightweight in-shape signal with no contract changes. The
BE hook already reads the summary; no new fields needed.

### 2. FE read shape for facts-only runs

The FE receives the **same artifact** as a normal run: facts, events,
placeholder narrative, cost block. The FE already distinguishes by the
`status` column (`ready` vs `facts_only`) — no new field-level cues needed.

The UI can:

- Show the facts table / event timeline (from the artifact)
- Surface the placeholder narrative as a muted note ("Narrative withheld: …")
- Badge the row as `facts_only` status

**No new artifact shape changes.** The sentinel headline is metadata (for the
hook's routing); the FE reads the artifact's actual narrative text as-is.

### 3. Headline policy for normal ready runs: deterministic code

For non-stripped runs, generate the headline **deterministically in code**,
without an LLM call:

**TA headline priority:**

1. If any event fired → use the **first fired event's label**
   (e.g., `"Price crossed above 50-day moving average"`)
2. If no events fired → use a **key metric summary**
   (e.g., `"RSI 72, above all SMAs"` or `"Price 4.2% below 52-week high"`)
3. If all metrics null → fallback: `"Data unavailable for analysis"`

**FA headline priority:**

1. If any metric is non-null → use the **most compelling metric + its value**
   (e.g., `"P/E ratio 12.5x, below historical average"` or
   `"Revenue growth 15% YoY"`)
2. If all metrics null → fallback: `"Data unavailable for analysis"`

**Rationale:** Reproducible, no extra LLM cost, no hallucinations, always
consistent on re-run. The headline anchors the card; the full narrative (if
not stripped) provides detail.

### 4. Empty-facts path: hard failure (TerminalJobError)

When the reference endpoint returns an empty facts block (no SMA/RSI/MACD data,
no quarterly metrics, etc.), the handler **raises `TerminalJobError`** before
any LLM call:

```python
def _handle_technical_job(envelope, backend_client, artifact_store, report_progress):
    # ... fetch reference
    facts = reference.get("technicalFacts", {})
    
    # Check for empty facts
    if not _facts_are_populated(facts):
        raise TerminalJobError(
            f"No technical data available for {symbol}; cannot analyze."
        )
    
    # ... proceed to narration
```

The job **fails terminally** — no artifact written, BE marks it `failed`, FE
shows a clear error state. This is distinct from a grounding strip (facts
present, narrative stripped).

**Rationale:** Empty facts = nothing to show the user. A placeholder artifact
with all-null facts is not useful; better to fail explicitly and let the FE
surface a "data unavailable" message.

---

### Consumer follow-on: BE hook `facts_only` mapping

Named follow-on in the spec (consumer section):

**BE implementation (after worker spec is done):**

Update the `technical_analysis.store.ts` / `fundamental_analysis.store.ts`
result hooks:

```typescript
// Parse the headline prefix
const headline = jobResult.summary.headline;
const isFacts = headline.startsWith("facts-only: ");

// Upsert with conditional status
await analyticsRepository.upsert({
  stockCode,
  analysisType: "technical",
  status: isFacts ? "facts_only" : "ready",
  headline,
  pointer: jobResult.pointer,
  // ... rest
});
```

No contract changes; the headline prefix is a de-facto convention between
worker and hook.
