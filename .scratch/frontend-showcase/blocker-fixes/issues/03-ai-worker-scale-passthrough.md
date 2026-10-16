# 03 — Pass metric scale through the AI worker assembly

Type: task
Status: ready-for-agent
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