# Contracts: HTTP response schemas

Type: task
Status: done
Blocked by: 00

## Task

Add Zod schemas for the backend read endpoints under
`packages/contracts/src/http/`, one file per area:

- `common`: `Page<T>`, `ProvenanceClass`, `ListingBoard`, `AnnouncementCategory`,
  `CorporateActionType`, `ShariahStatus`
- `stocks` (identity, fundamentals, technicals, shariah blocks)
- `search`, `screener` (rows and `/screener/fields`), `disclosures`, `calendar`,
  `news`, `market` (movers, indices, series, sectors), `brief`, `ipo` (the
  at-a-glance summary response), `auth` (`SessionUser`)

Source the shapes from `apps/backend/src/*/*.types.ts`, controllers and
`ipo.mapping.ts`. Export from the package root and add a `parseOrThrow` helper.
Do not add any of these to `modelOrder`.

## Done when

- A fixture test parses one sample per endpoint, taken from the backend
  integration-test expectations.
- `pnpm --filter @tuju/contracts check`, `test` and `typecheck` pass.
- Generated Python models are unchanged.

## Comments
