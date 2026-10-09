# Build ticket: KLCI 30 universe + hard-gate

Type: task
Status: resolved
Blocked by: (none)

> Execution of
> [backend handoff](../../poc-phase-a-backend/spec.md) § KLCI 30 universe seed
> (planning tickets 01 + 01a). Wave 1.

## Scope (this ticket only)

- Add `apps/backend/src/ingestion/klci30-universe.ts` — TS const array only.
  Do **not** extend `REFERENCE_UNIVERSE`.
- Row shape: `stockCode`, `yahooSymbol`, `shortName`, `fullName`, `board`
  (`Main`), `sectorName`, `aliases[]` — mirror `ReferenceCompany` + Yahoo.
- Paste the concrete 30 from
  [01a research](../../poc-phase-a-backend/issues/01a-klci30-membership-research.md)
  (as-of 2026-10-09). Must include `1155` / MAYBANK. Uniform `{code}.KL`.
- Export helpers: membership list + `isKlci30(stockCode: string): boolean`
  (and optionally `getKlci30Row(code)`).
- No HTTP routes, adapters, or ops commands in this ticket — later tickets
  import the helper to hard-gate.

## Out of scope

- Live scrape / auto membership refresh (PR-only edits forever).
- Seeding Postgres (`seed-klci` = ticket 03).
- Adapter DI (ticket 02).

## Testing seam

- Unit: list length === 30; unique `stockCode`; every `yahooSymbol` ends
  `.KL`; `1155` present; `isKlci30('1155')` true; `isKlci30('9999')` false.

## Acceptance

- Module committed; tests green; no Nest wiring yet beyond the file itself.

## Answer

- Module: `apps/backend/src/ingestion/klci30-universe.ts` — `KLCI30_UNIVERSE` (30 rows from 01a as-of 2026-10-09), `isKlci30`, `getKlci30Row`. Does not touch `REFERENCE_UNIVERSE`.
- Tests: `apps/backend/src/ingestion/klci30-universe.spec.ts` — length/unique/`.KL`/`1155`/`9999` green; backend typecheck clean.
