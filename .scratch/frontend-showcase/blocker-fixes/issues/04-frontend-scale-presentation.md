# 04 — Drive percentage presentation off scale, not metric id

Type: task
Status: resolved
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

## Comments

### Resolved 2026-10-16 — the rule, and the two forks it settled

`metricValue` now reads `scale` for the number and `unit` for the suffix, and
nothing else:

```ts
const shown = scale === 'fraction' ? value * 100 : value
if (unit === '%') return `${factValue(shown)}%`
if (unit === 'x') return `${factValue(shown)} ${unit}`
return `${factValue(shown)} · unit: ${unit} (unconverted)`
```

Two decisions the Fix section left open were taken explicitly:

1. **`×100` applies to a `fraction` for any unit**, not only when `unit` is `%`.
   This is deliberate and is the rule
   [`03`](03-ai-worker-scale-passthrough.md) settled
   (`services/ai/src/tuju_ai/ta_fa_analysis.py:_scaled_value`): `scale` picks the
   number, `unit` stays the suffix. Gating the conversion on `unit === '%'`
   would make this panel and the worker disagree for a `fraction` whose unit is
   not `%` — reintroducing by the back door the drift [04] exists to remove.
   No producer emits that pairing today; the point is that both sides would be
   reading the same contract field.
2. **`· unit: X (unconverted)` keeps its wording.** It is pinned by three tests
   and is a user-visible string. It refers to the *unit* not being rendered, not
   to the scale, which the comment above the fallback now states. In practice
   only `absolute` metrics reach it.

The dead `'percent' | 'ratio' | 'MYR' | 'myr' | 'RM'` vocabulary is gone, as item
4 required — [`01`](01-contract-percent-scale.md) regenerated the fixture to the
producer's `%` / `x` / `RM bn` tokens. A token with no rendering rule now lands in
the honest fallback instead of a legacy guess, which is the behaviour the audit
asked for. `'RM bn'` deliberately stays there: the stored value is in MYR, so
rendering it as billions would be false.

Zero and null are untouched: null and non-finite short-circuit **before** the
scaling line, so `metricValue({ value: null })` never multiplies, and `0` still
formats as `0`.

### The guard

Item 5's "a test fails if someone reintroduces an id-based scaling branch" is a
per-id matrix: `it.each(metricIds)` over all nine ids, each asserting the same
six `scale` × `unit` outcomes. Because the rule reads no id, the expected output
is identical for every id — so any id-special-cased branch fails on the row for
that id. The id-based table that this ticket deleted could not have passed it.

`stock-analysis-panel.test.tsx` gained a component-level case: the fixture's
`revenue_growth_qoq` is re-declared `fraction` at `0.021` and must render
`2.1%`, proving the panel reads the metric it is given rather than knowing which
growth metric it is.

### Verification — 2026-10-16

The change is confined to `apps/frontend`, so the lane was narrowed to it by the
same reasoning [05](05-artifact-timestamp-conformance.md) used. No contract, no
backend, no worker change; no published type moved.

```bash
pnpm --filter frontend typecheck   # OK
pnpm --filter frontend test        # 23 files, 351 passed (was 336)
pnpm --filter frontend build       # OK
pnpm --filter frontend test:e2e    # 6 passed
TZ=America/Los_Angeles pnpm --filter frontend test   # 23 files, 351 passed
TZ=Pacific/Kiritimati  pnpm --filter frontend test   # 23 files, 351 passed
```

+15 tests, no skips. The two timezone runs are the ticket's own Limit: date
handling shares this file and must not regress.

**The revert proof.** With `analysis-presentation.ts` restored from `HEAD` and
the tests kept, **the same 11 tests fail** — the panel case, the `x` + `fraction`
row, and one guard case per metric id (all nine). Restoring the file returns the
suite to 351 passed. The guard bites on the exact defect it was written for.

### Still open, and not this ticket

- **Real-artifact verification is [09](09-bounded-rerun-readiness-reaudit.md)'s
  job.** The map previously advised holding 04 back until a genuine
  `fundamental-analysis-2` artifact existed; that advice was wrong on the
  ticket's own terms (its Limits section permits code-and-fixture verification
  now, live verification later), and holding the id table in place until an
  operator-gated run only widens the window where the headline and the panel
  agree by coincidence. Code is done; the live confirmation rides with 09.
- The FA **narrative** still has its own display path. `grounding.py` accepts a
  fraction's whole-unit rendering so a correct "5.67%" stays grounded, but the
  narration text itself is model prose and is not re-scaled here.
- `lib/format.ts`'s percent handling for the screener and market surfaces is a
  separate code path over different DTOs, untouched.