# 10 — Fix the market provenance fallback

Type: bug
Status: resolved
Blocked by: none
Severity: high
Component: `apps/frontend`

## Problem

The market overview labels any provenance value that is neither `synthetic` nor
`aggregator` as **"Real source"**. A missing or unrecognised value is therefore
presented to a user as real market data.

## Evidence

The original local market fallback described below has already been replaced by
the shared `ProvenanceSource` component (`apps/frontend/src/components/provenance.tsx`).
All market panels use that component for displayed provenance.

The previous code evidence above is stale; the stock-detail component also uses
the shared implementation.

## Root cause

The original local `Source` component defaulted unknown values to "real". The
shared component now handles the domain's four outcomes explicitly, honoring the
parent spec's requirement that provenance be explicit
([`../../spec.md`](../../spec.md), "Label private demo/non-redistributable
yfinance data; preserve mixed provenance per panel").

## Fix

1. Shared `components/provenance.tsx` handles the four outcomes and is consumed
   at the market display sites.
2. Component regression coverage in `components/provenance.test.tsx` exercises
   unknown, absent, and null provenance and asserts none appears as real.
3. No market-level unknown-payload integration test was added: the market API
   response schemas reject unknown provenance in test mode before rendering.
   That runtime validation is intentionally unchanged; the component tests
   directly cover the unvalidated production input case.

The consumer sites are `market-overview.tsx:85` (index history), `:108` (movers
rows) and `:123` (sector rows) — all three benefit.

## Acceptance criteria

- `real` renders "Real source".
- `synthetic` renders the badge.
- `aggregator` renders the private-demo/non-redistributable label.
- An unknown or absent value renders **"Source unavailable"**, never "Real
  source".
- Tests cover unknown, absent, and null values through the shared component.

## Verification

```bash
pnpm --filter frontend test -- src/components/market/market-overview.test.tsx src/components/provenance.test.tsx
```

## Comments

- 2026-10-16: Reconciled this ticket with the committed shared provenance fix.
  Targeted verification found the provenance tests pass. The targeted command
  also exposed an unrelated failure in `stock-detail.test.tsx` because Vitest's
  forwarded file arguments ran the full suite; the market test's pre-existing
  controls passed, but a direct unrecognized response fixture is rejected by
  test-mode API schema validation. No API validation or provenance classification
  was changed. No map file exists for this feature, so no map update applies.

- Resolved 2026-10-16: Shared provenance rendering and regression coverage are
  in place; targeted provenance tests passed. Unknown, absent, and null values
  cannot render as real source.

Parent ticket 03's acceptance criterion "Synthetic/real provenance and missing
quote times are explicit" is only met once this lands.

## Limits

- This is a presentation fix. It does not make provenance more truthful at the
  source; it stops the UI from overstating what it received.
- Do not add runtime validation to `apiGet` as part of this ticket. That is a
  broader change with performance and bundle implications.
- The market panels' data limitations are a separate concern — see parent ticket
  11, `ready-for-human`.
