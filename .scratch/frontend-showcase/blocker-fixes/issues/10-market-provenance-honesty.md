# 10 — Fix the market provenance fallback

Type: bug
Status: ready-for-agent
Blocked by: none
Severity: high
Component: `apps/frontend`

## Problem

The market overview labels any provenance value that is neither `synthetic` nor
`aggregator` as **"Real source"**. A missing or unrecognised value is therefore
presented to a user as real market data.

## Evidence

`apps/frontend/src/components/market/market-overview.tsx:24-28`:

```tsx
function Source({ value }: { value: ProvenanceClass }) {
  return value === 'synthetic'
    ? <ProvenanceBadge kind="synthetic" />
    : <span className="text-xs text-fg-3">{value === 'aggregator' ? 'Aggregator · private demo / non-redistributable' : 'Real source · not a live quote guarantee'}</span>
}
```

The final `else` catches `real` **and** anything else. This matters because
production `apiGet` skips runtime response validation
(`apps/frontend/src/lib/api.ts`, `VALIDATE_RESPONSES`), so the `ProvenanceClass`
type is not enforced at runtime — an unknown or absent value arrives as-is.

The sibling implementation in the same codebase gets it right, with a fourth
branch for the unknown case —
`apps/frontend/src/components/stocks/stock-detail.tsx:16-19`:

```tsx
return value === 'synthetic' ? <ProvenanceBadge kind="synthetic" />
  : <span className="text-xs text-fg-3">{value === 'real' ? 'Real source' : value === 'aggregator' ? 'Aggregator source' : 'Source unavailable'}</span>
```

## Root cause

The `Source` component was written as a two-way branch when the domain has four
outcomes. Defaulting the unknown case to "real" inverts the intent of the parent
spec, which requires provenance to be explicit
([`../../spec.md`](../../spec.md), "Label private demo/non-redistributable
yfinance data; preserve mixed provenance per panel").

## Fix

1. Make `market-overview.tsx:24-28` a four-way branch matching
   `stock-detail.tsx:16-19`: `synthetic` -> badge, `real` -> "Real source",
   `aggregator` -> the private-demo label, anything else ->
   **"Source unavailable"**.
2. Prefer extracting one shared component rather than maintaining two copies.
   Both files already have a local `control` string constant and a local `Source`
   with near-identical shapes. A single `components/provenance.tsx` export would
   remove the divergence permanently — but if that collides with
   [13](13-chart-design-conformance.md) or
   [15](15-doc-drift-and-dead-code.md) file touching, keep the fix local and note
   the duplication rather than coordinating three tickets.
3. Add a test case for the unknown-provenance path. This is the branch with no
   coverage today, which is why the bug survived.
4. Update `market-overview.test.tsx`.

The consumer sites are `market-overview.tsx:85` (index history), `:108` (movers
rows) and `:123` (sector rows) — all three benefit.

## Acceptance criteria

- `real` renders "Real source".
- `synthetic` renders the badge.
- `aggregator` renders the private-demo/non-redistributable label.
- An unknown or absent value renders **"Source unavailable"**, never "Real
  source".
- A test covers the unknown branch.

## Verification

```bash
pnpm --filter frontend test
pnpm --filter frontend typecheck
```

Parent ticket 03's acceptance criterion "Synthetic/real provenance and missing
quote times are explicit" is only met once this lands.

## Limits

- This is a presentation fix. It does not make provenance more truthful at the
  source; it stops the UI from overstating what it received.
- Do not add runtime validation to `apiGet` as part of this ticket. That is a
  broader change with performance and bundle implications.
- The market panels' data limitations are a separate concern — see parent ticket
  11, `ready-for-human`.