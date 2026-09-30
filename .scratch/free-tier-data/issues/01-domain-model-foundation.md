# Build ticket: Free-tier domain model foundation (entities + migration)

Type: task
Status: resolved
Blocked by: (none)

> Execution effort breaking down
> [spec 01 — data ingestion + domain model](../../free-tier-specs/01-data-ingestion-and-domain-model.md).
> This is the **first build ticket**: the relational model everything else FKs to.
> Fixed inputs: ADR-0001–0011 (esp. ADR-0002/0004), `apps/backend/CONTEXT.md` glossary.

## Scope (this ticket only)

The shared relational domain model as TypeORM entities + one boot migration, wired
into `data.module.ts` and `data-source.ts`. This is the schema every other free-tier
spec (02 search/stock page, 03 screener, 04 announcements, 05 market overview,
06 AI showcase) reads. Nothing reads until these tables exist, so it lands first.

### Entities

- **`IngestionRun`** — provenance lineage root. Records `adapter` + `provenanceClass`
  (`synthetic` / `aggregator` / `real`). Every sourced row FKs `ingestionRunId`.
  Single-table-inheritance base for `SyntheticRun`.
- **`SyntheticRun`** — STI child carrying `seed` + generation `params` (decision A1).
- **`Sector`** — Bursa sector/subsector reference entity.
- **`Company`** — listed issuer; FKs `Sector`. Owns fundamentals, financials,
  announcements, Shariah status. Carries curated `aliases` (feeds spec 04 news tagging).
- **`Instrument`** — tradable ordinary-share line; unique natural key `stockCode`
  (Bursa 4-digit); mutable `shortName`/`fullName`; FKs `Company`.
- **`PriceBar`** — per-instrument daily OHLCV; FKs `Instrument` + `ingestionRunId`.
- **`QuarterlyFinancials`** — per-company per-fiscal-quarter source-of-truth line items.
- **`FundamentalsSnapshot`** — derived per-company latest rollup (TTM + materialised ratios).
- **`IndicatorSnapshot`** — one current row per instrument (SMA/RSI/MACD/52wk hi-lo/close).
- **`CorporateAction`** — dividend/bonus/split/rights; single source for calendar + DY.
- **`ShariahStatus`** — per-company compliance history (status + effectiveDate).
- **`Announcement`** — official disclosure; `category` enum; owns `aiSummary` (spec 04/06).
- **`NewsArticle`** + **`NewsArticleTag`** — headline+link; M2M to Company (spec 04 tagging).
- **`IpoListing`** — curated calendar row (manual entry).
- **`Watchlist`** + **`WatchlistItem`** — `User → Watchlist → Instrument`; only account-bound entity.

### Provenance = lineage, not a per-row column

Sourced rows (`PriceBar`, `QuarterlyFinancials`, `FundamentalsSnapshot`,
`IndicatorSnapshot`, `CorporateAction`, `ShariahStatus`, `Announcement`, `NewsArticle`)
carry `ingestionRunId`. Reference rows (`Sector`/`Company`/`Instrument`) also carry it
(the real public-reference run). The decision-B purge = delete rows whose run's
`provenanceClass` is `synthetic`/`aggregator`.

### Migration

One migration creating all tables + enums (`provenance_class`, `announcement_category`,
`corporate_action_type`, `shariah_status`, `ingestion_run_kind`), FKs, and a **`pg_trgm`
GIN index** on `instrument` name columns (spec 02 fuzzy search). `pgcrypto` already enabled.

## Out of scope (later tickets under this effort)

- Source-adapter seam interfaces + demo adapters (ticket 02).
- Synthetic co-generation generator + seeded reconciliation (ticket 03).
- Ingestion worker process + `@nestjs/schedule` crons (ticket 04).
- Ratio computation / indicator computation logic (materialisation lives with ingest).
- ADR-0012 (worker + TS-indicators) — written when the worker ticket lands.
- Read endpoints (owned by specs 02–06).

## Testing seam (TDD)

Unit tests over TypeORM metadata (no live DB — unit lane has no Docker, ADR-0011):

- **Provenance lineage:** every sourced entity exposes an `ingestionRun` relation +
  `ingestionRunId` FK column.
- **Entity shape:** Company/Instrument split (Instrument FKs Company; `stockCode` unique);
  Watchlist is the only entity relating to `User`; enums registered with expected values.

Reconciliation / purge / cadence integration tests belong to the generator + worker tickets.

## Answer

Implemented on `main` (commit `3b0b2bf`). 18 TypeORM entities + `enums.ts` in
`apps/backend/src/data/entities/`, one boot migration
(`1727700000000-FreeTierDomainModel.ts`) creating all 16 tables + 6 native
Postgres enum types + `pg_trgm` GIN indexes on the instrument name columns,
wired into `data.module.ts` and `data-source.ts`. Unit tests
(`domain-model.spec.ts`) assert the model shape via TypeORM metadata (no DB):
provenance lineage on every sourced table, Company/Instrument split, STI
discriminator, native enum columns, watchlist as the only account-bound entity.
Verified: typecheck clean; 46/46 backend unit tests pass. Code-reviewed
(Standards + Spec axes); the one substantive finding (DB enums vs varchar) fixed.
