# 04 — Drive percentage presentation off scale, not metric id

Type: task
Status: ready-for-agent
Blocked by: 01
Severity: high
Component: `apps/frontend`

## Problem

The frontend carries a hardcoded table of which metric ids are fractions, which
are percentage points, and which unit strings exist. It encodes producer
knowledge in the presentation layer, and it silently disagrees with itself across
two unit vocabularies.

## Evidence

`apps/frontend/src/components/stocks/analysis-presentation.ts:22-24`:

```ts
const percentage = unit === 'percent' || (unit === '%' && (id === 'dividend_yield' || id === 'roe'))
if (percentage) return `${factValue(value * 100)}%`
if (unit === '%' && id.includes('_growth_')) return `${factValue(value)}%`
```

The same id has **opposite** scaling depending on which unit vocabulary the
producer used: `profit_growth_qoq` is a fraction under `percent` in the golden
fixture and a percentage point under `%` from the backend
(see [`../audit.md`](../audit.md) §"Root cause of F2").

Consequences:

- If the backend switches its unit token, or changes one metric's scaling, the
  frontend renders `2.1%` as `0.021%` with no error, no test failure and no log.
- The branches for `'ratio'` and `'myr'` at `:25-26` exist only because the
  fixture uses a different vocabulary from the producer. Both are dead in
  production and live in tests.

## Root cause

The unit string was treated as a complete description of a numeric value when it
is only half of one. See [01](01-contract-percent-scale.md).

## Fix

1. Delete the per-metric-id table. `metricValue`
   (`analysis-presentation.ts:20-27`) reads `metric.scale` and nothing else about
   which metric it is:
   - `fraction` -> multiply by 100, display with `%`
   - `percentage_point` -> display as-is with `%`
   - `absolute` -> display with the metric's `unit` and no conversion
2. Keep `unit` for display on the absolute branch. Keep the existing
   unknown-unit escape hatch so an unrecognised unit shows `unit: X
   (unconverted)` rather than a wrong number.
3. Keep zero and null exactly as they are — zero is formatted, null is
   `Unavailable`. Do not let the scale work disturb that; it is a separately
   tested behaviour.
4. Drop the now-dead `'ratio'`, `'percent'` and `'myr'` vocabulary branches once
   the fixture from [01](01-contract-percent-scale.md) is regenerated.
5. Update `analysis-presentation.test.ts` and
   `stock-analysis-panel.test.tsx` to cover all three `scale` values, and delete
   the test that pins the current id-based behaviour.

## Acceptance criteria

- No presentation decision branches on metric id.
- All three `scale` values render correctly, and `unit` is used for display only.
- An unknown `unit` remains shown unconverted rather than guessed.
- Zero remains distinct from null.
- A test fails if someone reintroduces an id-based scaling branch.

## Verification

```bash
pnpm --filter frontend typecheck
pnpm --filter frontend test
```

Add the regression in item 5 deliberately — it is the guard that makes this
ticket durable rather than a one-time cleanup.

## Limits

- **Code-only verification is possible; end-to-end is not.** Typecheck and unit
  tests pass against the regenerated fixture once [01](01-contract-percent-scale.md)
  lands. Real-artifact behaviour additionally needs
  [02](02-backend-fa-scale-producer.md) and [03](03-ai-worker-scale-passthrough.md),
  plus a generation run that
  [09](09-bounded-rerun-readiness-reaudit.md) owns. Record that limit rather than
  implying live verification.
- Do not normalize metric values in the frontend. Scaling is display-only.
- The timezone robustness reported by parent ticket 05 (31 and 42 tests under
  `America/Los_Angeles` and `Pacific/Kiritimati`) must still pass — date
  handling is not part of this ticket but must not regress.