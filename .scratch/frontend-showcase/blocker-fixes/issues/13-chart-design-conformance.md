# 13 — Conform chart volume colouring to DESIGN.md

Type: task
Status: ready-for-agent
Blocked by: none
Severity: low
Component: `apps/frontend`

## Problem

The stock history chart colours volume bars with a chart series token.
`DESIGN.md` reserves `--up` / `--down` for exactly that meaning, and flags the
token used as a documented near-match of a semantic colour.

## Evidence

`apps/frontend/src/components/stocks/stock-history-chart.tsx:44`:

```tsx
{point.volume !== null && <rect ... fill="var(--chart-6)" />}
```

`apps/frontend/DESIGN.md:121`:

> Price up/down in OHLC and **volume uses `--up` / `--down`, not chart series.**

`DESIGN.md:139-141` records `--chart-6` and `--info` as a known near-match pair
with worst-case CIEDE2000 dE 4.0 — inside the "cannot tell apart under colour
vision deficiency" threshold. A volume bar rendered in `--chart-6` sitting next to
an `--info`-styled element is exactly the confusability the design system
documents.

The price line in the same component uses `currentColor` / `--chart-1`, which is
correct per `DESIGN.md:121`.

## Root cause

The volume pane was styled without consulting the design system's semantic-colour
rule, which applies to volume specifically rather than generally.

## Fix

1. Change the volume rect at `stock-history-chart.tsx:44` to use `--up` / `--down`.
   Decide and document the direction rule from data the producer actually
   supplies. If the stored bars carry no up/down direction, do **not** invent one
   from price movement against the previous bar without stating that it is a
   derived cue — a second cue beyond colour is required by `DESIGN.md:120`, and
   `DESIGN.md:122` also expects a tinted volume pane and vertical gridlines that
   this chart does not currently have.
2. Keep the gap behaviour: bars must still be omitted, never zeroed, where close
   or volume is unusable.
3. Add or extend a test asserting the applied token, so this cannot silently
   regress.
4. Re-check contrast against `--surface-1` if any token changes.

## Acceptance criteria

- Volume bars use `--up` / `--down`, not a chart series token.
- A non-colour cue distinguishes direction, per `DESIGN.md:120`.
- No token from the documented near-match list is placed next to its semantic
   counterpart without a label or marker (`DESIGN.md:141`).
- Existing gap and empty-state behaviour is unchanged.

## Verification

```bash
pnpm --filter frontend test
pnpm --filter frontend typecheck
pnpm --filter frontend build
```

Parent ticket 04's timezone runs over `stock-history.test.ts` and
`stock-history-chart.test.tsx` (31 tests each under two TZs) must still pass.

## Explicitly deferred — shared chart primitives

Parent ticket 03's work item "share chart primitives with stock work where useful"
is **not done** and this ticket does not do it. Two independent SVG chart
implementations exist with duplicated `<details>`/table scaffolding:

- `apps/frontend/src/components/market/market-overview.tsx:46-73`
- `apps/frontend/src/components/stocks/stock-history-chart.tsx:7-67`

They serve different data (index level vs stock close + volume), have different
inspection affordances (market has a table only; stock has a native slider plus
table), and both have passing focused tests. Extracting a shared primitive would
couple two independently verified components for the sake of similarity.

**Recommendation: file a separate ticket** if the duplication is judged
unacceptable, scoped as an explicit refactor with its own visual regression
review. Record this decision under `## Comments` so it is not re-litigated each
time someone notices the duplication.

Also deferred: the market chart has no keyboard inspection control, only a
collapsed `<details>` table. That satisfies parent ticket 03's accessibility
criterion literally, but the asymmetry with the stock chart's slider is worth a
decision. Same recommendation — separate ticket, not here.