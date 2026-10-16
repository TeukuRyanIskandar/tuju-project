# 02 — Emit honest metric scale from the FA reference producer

Type: task
Status: ready-for-agent
Blocked by: 01
Severity: high
Component: `apps/backend`

## Problem

The backend stamps `unit: '%'` on two different scales, so the string is not a
reliable signal for any consumer.

## Evidence

`apps/backend/src/stocks/analysis-reference.ts:103-201` builds exactly nine
metrics:

| Lines | Metric | Stamped unit | True scale |
| --- | --- | --- | --- |
| `:105-112` | `trailing_pe` | `'x'` | ratio |
| `:114-119` | `dividend_yield` | `'%'` | **fraction** |
| `:121-126` | `roe` | `'%'` | **fraction** |
| `:133-139` | `debt_to_equity` | `'x'` | ratio |
| `:147-157` | `revenue_growth_qoq` | `'%'` | **percentage point** |
| `:161-167` | `revenue_growth_yoy` | `'%'` | n/a, always `null` |
| `:171-180` | `profit_growth_qoq` | `'%'` | **percentage point** |
| `:184-190` | `profit_growth_yoy` | `'%'` | n/a, always `null` |
| `:193-201` | `operating_cash_flow` | `'RM bn'` | unconverted, always `null` |

Why the fraction rows are fractions:
`apps/backend/src/data/synthetic/ratios.ts:119-143` returns `dps / latestClose`
and `ttmNetProfit / averageEquity` as raw decimal ratios. `0.045` there means
4.5%.

Why the growth rows are percentage points: they are computed inline as
`((q0 - q1) / Math.abs(q1)) * 100` at `:151` and `:175` — already multiplied by
100.

## Root cause

The producer was written to display-friendly strings and never recorded the
numeric convention of each value.

## Fix

1. Add `scale` to each of the nine metric objects in
   `apps/backend/src/stocks/analysis-reference.ts`:
   - `dividend_yield`, `roe` -> `scale: 'fraction'`
   - `revenue_growth_qoq`, `profit_growth_qoq` -> `scale: 'percentage_point'`
   - `revenue_growth_yoy`, `profit_growth_yoy` -> `scale: 'percentage_point'`
     (consistent with their siblings; the value is `null`, so the scale is
     currently unobservable but must stay correct once depth improves)
   - `trailing_pe`, `debt_to_equity`, `operating_cash_flow` -> `scale: 'absolute'`
2. **Do not rescale the values.** The contract records the scale that is already
   true. Changing `dividend_yield` from 0.045 to 4.5 here would silently break
   every stored artifact and every other consumer.
3. Leave `unit` exactly as-is.
4. Update any backend tests asserting the reference metric shape.

`operating_cash_flow` and its `'RM bn'` unit is a separate, real gap — the value
is never ingested and the frontend prints it unconverted. Leave it visible; do
not bundle a fix.

## Acceptance criteria

- All nine metrics carry an explicit `scale` matching the table above.
- No metric value changes as a side effect. Prove this in the test, do not assert
  it by inspection.
- The reference response still satisfies its HTTP contract.
- Growth metrics remain percentage points; dividend yield and ROE remain
  fractions.

## Verification

```bash
pnpm --filter backend test
pnpm --filter backend typecheck
pnpm --filter backend build
```

Add or extend a test asserting the nine `(id, unit, scale)` triples, and one
asserting a `dividend_yield` of `0.045` is still emitted as `0.045` with
`scale: 'fraction'`.

## Limits

- The backend's reference endpoint is a **worker-facing API**. Per
  [`../../spec.md`](../../spec.md) it must never be called from the browser, and
  this ticket does not change that boundary.
- Does not touch the stored artifact. [03](03-ai-worker-scale-passthrough.md)
  must land before the next FA generation, or the worker's contract validation
  will reject every artifact for a missing `scale`.