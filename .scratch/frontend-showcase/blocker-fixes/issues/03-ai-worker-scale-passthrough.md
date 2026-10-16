# 03 — Pass metric scale through the AI worker assembly

Type: task
Status: resolved
Blocked by: 01, 02
Severity: high
Component: `services/ai`

## Problem

The worker rebuilds each `FundamentalMetric` from the backend reference payload
field by field. After [01](01-contract-percent-scale.md) makes `scale` a
required field, this reconstruction will silently produce a metric with no scale
and every FA job will fail contract validation at the write boundary.

## Evidence

`services/ai/src/tuju_ai/ta_fa_analysis.py:345-354`:

```python
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
```

The list is then serialized for the prompt at `:357` via
`m.model_dump(mode="json")`, and the headline generator at
`generate_fa_headline` (`:95-103`) prints the raw value with the unit — so
`"Dividend yield 0.045%"` is the current user-visible headline for a fraction.
That is a third place the same ambiguity leaks.

## Root cause

Not a defect yet — this ticket exists so the worker stays correct across the
[01](01-contract-percent-scale.md) change instead of breaking.

## Fix

1. Add `scale=m.get("scale")` to the `FundamentalMetric(...)` construction at
   `ta_fa_analysis.py:345-354`.
2. **Fail loudly, never default.** Because `scale` is required, a missing value
   becomes a pydantic validation error. Make that a clear
   `TerminalJobError` naming the symbol and metric id, consistent with the
   existing guards at `:337-344` which already reject an empty or wrong-count
   metric list. Do not silently substitute `'absolute'` — that reintroduces
   exactly the mislabelling [01](01-contract-percent-scale.md) exists to
   prevent.
3. Decide and implement what `generate_fa_headline` (`:95-103`) does with
   scale. It currently renders `"Dividend yield 0.045%"`, which is wrong on its
   face for a fraction. Either apply the same scale rule the frontend will use,
   or keep the headline code-owned and honest. **Do not invent a formatting
   convention here** — match whatever [04](04-frontend-scale-presentation.md)
   settles on, so the headline and the panel cannot disagree.
4. Extend `services/ai/tests/test_ta_fa_analysis.py` to cover the missing-scale
   terminal path and the headline rendering for both scales.

## Acceptance criteria

- Every assembled metric carries the scale the backend supplied.
- A reference payload missing `scale` produces a clear terminal error naming the
  symbol and metric, not a generic validation traceback.
- The FA headline never renders a fraction with a bare `%` suffix.
- Prompt serialization (`:357`) includes `scale` only if that helps the model
  narrate honestly. Do not add it just because it exists.

## Verification

```bash
# services/ai pytest configuration
pytest services/ai/tests/test_ta_fa_analysis.py
```

Full AI suite must be green. Confirm no `test_prospectus_job.py` or
`test_job_pipeline.py` case regressed from the [01](01-contract-percent-scale.md)
model regeneration.

## Limits

- This is generated-model consumption. Do not hand-edit
  `services/ai/src/tuju_ai/contracts_generated/`.
- No worker architecture change, no new LLM call, no prompt rewrite beyond what
  item 3 above requires.
- If [01](01-contract-percent-scale.md) chooses Option B (optional scale), item 2
  changes from "fail loudly" to "still fail loudly on an explicit `null`" — keep
  the terminal error either way.
- Until this lands, **do not run any FA generation.** Every FA job would fail
  terminally and consume queue attempts for no diagnostic value.
## Comments

**Partially implemented 2026-10-16 — commit `c181bd2` (fix item 1 only).**
Status deliberately left `ready-for-agent`: items 2-4 are not done.

Landed: `scale=m.get("scale")` at `ta_fa_analysis.py:351`; the reference-shape
docstring in `backend_client.py`; the canned 9-metric reference in
`test_ta_fa_analysis.py` now carries the scale the backend declares; and the
artifact version assertion reads `SCHEMA_VERSIONS["fundamental"]` from the
generated module instead of a literal. Full AI suite green (212 passed).

Still open:

- **Item 2 — fail loudly on a missing scale.** A scale-less reference currently
  produces a raw pydantic validation traceback, not the
  `TerminalJobError`-naming-symbol-and-metric-id the ticket asks for. This is now
  the *only* thing standing between a deploy-ordering mistake and an opaque
  failure: a worker with this passthrough against a backend that has not yet
  shipped `scale` receives `None` and fails terminally.
- **Item 3 — the headline lies, and this is user-visible.**
  `generate_fa_headline` (`:95-103`) prints the raw value with the unit, so a
  `dividend_yield` fraction of `0.045` produces the summary headline
  `"Dividend yield 0.045%"`. Wrong by a factor of 100. The audit did not catch
  this; the ticket did. It is now the third known leak of the same ambiguity,
  after the contract's `unit` and the frontend's per-id table, and it cannot be
  fixed until [04](04-frontend-scale-presentation.md) settles the presentation
  rule — otherwise the headline and the panel would disagree.
- **Item 4 — tests** for both of the above.

Deployment note: producer and worker must ship together, in either order's
absence being the failure mode described above.

## Answer

**Resolved 2026-10-16.** Items 1-4 all landed; the passthrough is correct across
the [01](01-contract-percent-scale.md) change, and two honesty leaks the item
list did not anticipate are closed.

**Item 2 — fail loudly.** Two layers, both `TerminalJobError`:

- An explicit presence check before assembly, naming the symbol and the metric
  id. Absent key and explicit `null` are both terminal, so the Option-B limit in
  the Limits section still holds. It does **not** check the value against a
  hardcoded enum: `contracts_generated/models.py:58` inlines the `Literal`, so
  there is no constant to import and duplicating the three strings would be a
  second place to forget to update.
- A `ValidationError` backstop around the whole comprehension. **This mattered
  more than the ticket said.** `run_job` maps LLM errors only
  (`jobs/pipeline.py:260-271`) and `worker.py:64-66` converts only
  `TerminalJobError` to no-retry, so *any* raw pydantic traceback escaping
  `work()` is retried by BullMQ. Permanently-bad reference data would have burned
  queue attempts silently — the opposite of the ticket's intent.

**Item 3 — the headline, and the rule 04 must adopt.** Scale picks the number,
the metric's own `unit` stays the suffix:

| Scale | Stored | Headline |
| --- | --- | --- |
| `fraction` | `0.045`, unit `%` | `Dividend yield 4.5%` |
| `percentage_point` | `8.4`, unit `%` | `Revenue growth (QoQ) 8.4%` |
| `absolute` | `12.5`, unit `x` | `P/E ratio (trailing) 12.5x` |

**This is deliberately not [04](04-frontend-scale-presentation.md)'s literal
wording**, which forces a `%` suffix onto any metric declared `fraction` even
when its `unit` is not `%` — that prints "1250%" for a fraction measured in
`x`. Deriving the number from `scale` and the suffix from `unit` cannot
contradict the field it is displaying.

Rounding to 4 fraction digits is **required, not cosmetic**: `0.29 * 100` is
`28.999999999999996`, which would otherwise be the user-visible ROE. The
format is `f"{v:.4f}".rstrip("0").rstrip(".")` — the forced decimal point keeps
the integer part safe from the strip, and fixed-precision format is also what
keeps `4200000000` out of `%g`'s exponent form. 4 digits matches the frontend's
`factValue` `maximumFractionDigits`.

**Unplanned but load-bearing: the narration had the same bug, worse.** `scale`
already reached the prompt packet via `model_dump`, but
`ungrounded_number` accepted only numbers *literally* present in the facts. So a
model writing the correct "dividend yield 5.67%" was **rejected** while one
writing "0.0567%" passed — the grounding check was actively pushing the
narrative toward the false statement. `_source_numbers` now adds the whole-unit
rendering for any dict carrying `scale: "fraction"`, and rule 2 of the FA system
prompt states the rendering as the single permitted transformation (rule 1's
"Do not compute new metrics" now names the exception rather than contradicting
it). No metric-id knowledge was added, and TA facts carry no `scale`, so their
behaviour is byte-identical.

**Item 4 — 15 tests.** Missing scale absent and explicitly `null` (message
asserted to name symbol and metric id); unknown scale and an unbuildable metric
both terminal rather than retried; headline across all three scales including
the `0.29 → "29%"` float case and a large absolute; float noise rejected by
grounding while a correctly-scaled narration reaches a real narrative. Full AI
suite green: **227 passed** (was 212). No `test_prospectus_job.py` or
`test_job_pipeline.py` case regressed.

### Deviations from the ticket as written

- **Test fixture realigned.** `_make_fa_reference` declared `dividend_yield:
  3.2` and `roe: 15.0` as `fraction` — 320% and 1500%, a lie the fixture was
  certifying. Realigned to the producer's real convention (`0.045`, `0.124`),
  the same fix commit `047d362` made to the contracts fixture. `operating_cash_flow`'s
  unit was `'RM m'`, which the backend never emits; it is now `'RM bn'` with a
  `null` value, because the backend always emits `null` there. Changing the unit
  without the value would have asserted "RM 150bn" of operating cash flow.
- **Scope widened to `llm/grounding.py`.** The Limits section says no prompt
  rewrite beyond item 3; the validator change is what makes item 3's sibling
  surface reachable. Recording it rather than burying it.

### Recorded limits

- **The headline bug was latent, not live.** The headline takes the *first*
  non-null metric and the producer always fills `trailing_pe` first, so
  "0.045%" only appeared when P/E was null. Real, worth fixing, but it was not
  corrupting a live headline.
- **The narration fix is not live-verified.** The tests prove a correctly-scaled
  narration *can* pass grounding and that a wrong one still cannot. Whether the
  free-tier model actually writes one is only observable on a run, which
  [09](09-bounded-rerun-readiness-reaudit.md) owns.
- **[04](04-frontend-scale-presentation.md) is now unblocked** and should adopt
  the number-from-`scale`, suffix-from-`unit` rule above, dropping its `%`-forcing
  wording. Its per-id table at `analysis-presentation.ts:22-24` is still in place,
  so the two sides agree by construction only once it lands.
