# Build ticket: MarketIndex / IndexLevel entities + migration

Type: task
Status: resolved
Blocked by: (none â€” spec 01 is fully resolved)

> Wave 1 of the spec-05 execution effort breaking down
> [spec 05 â€” market overview](../../free-tier-specs/05-market-overview.md).
> Fixed inputs: ADR-0001â€“0012, the spec-01 entities/migrations in
> `apps/backend/src/data/entities/` (additive only â€” redefined nothing), and the
> glossary entries already in `apps/backend/CONTEXT.md`.

## What to build

The additive model pair spec 05 introduces â€” nothing else, no behaviour:

1. **`MarketIndex`** â€” a reference entity naming an index: the FBM KLCI
   analogue headline index plus one index per Bursa `Sector` (a `kind`
   discriminator: headline vs sector, with the sector FK on the sector rows).
   Membership is derived, not stored: headline = the whole analysed universe
   (Main+ACE ordinary shares), a sector index = that sector's instruments.
2. **`IndexLevel`** â€” one level per index per day (a daily series parallel to
   price bars, so an index is chartable), FK-ing its `IngestionRun` for
   provenance lineage (lineage, not a per-row marker â€” the ticket-10-of-
   free-tier decision). Natural-key upsert (`(index, date)`) per the
   re-ingest-idempotency lesson from `free-tier-data` ticket 05.

Entities + migration only â€” no adapter, no computation, no reads (tickets 02â€“05).

## Acceptance criteria

- [ ] `MarketIndex` + `IndexLevel` entities land in the spec-01 entities home as
      an additive change; no spec-01 entity or existing migration is modified.
- [ ] Migration runs cleanly up and down on testcontainers Postgres.
- [ ] `IndexLevel` rows are purgeable by lineage: a synthetic run's levels are
      deleted by the decision-B purge shape (schema-level FK + purge
      compatibility; the purge integration is ticket 02's wiring).
- [ ] Re-ingest idempotency by construction: natural-key upsert on
      `(index, date)`, stable row ids on update.
- [ ] Typecheck + existing full suite green (no behaviour changed).

## Out of scope (later tickets under this effort)

- The `IndexAdapter` seam, `SyntheticIndexAdapter`, and nightly computation
  (ticket 02).
- Intraday live levels + movers precompute (ticket 03).
- All `GET /market/*` endpoints (tickets 04, 05).
- Movers liquidity/market-cap floor, official-index licensing, charting/OHLC
  series, anonymous rate-limit posture â€” spec 05 Out of Scope.

## Answer

Resolved as entities + migration only, no behaviour (tickets 02–05 untouched):

- `MarketIndex` (`market_indices`) — reference entity with the `kind`
  discriminator (`market_index_kind` enum: `headline` / `sector`), nullable
  `sector_id` FK (RESTRICT, the Company?Sector precedent — sectors are real
  reference data), `(kind, sector_id)` natural key (`NULLS NOT DISTINCT`, the
  `ipo_listings` precedent, so the headline row also re-ingests as an
  in-place upsert), and `ingestion_run_id` lineage like every sourced row.
  Membership deliberately derived, not stored (no constituent join).
- `IndexLevel` (`index_levels`) — one level per index per day, `(index_id,
  level_date)` natural-key upsert (stable row ids, lineage re-points to the
  fresh run), `level numeric(18,6)`, `ingestion_run_id` FK RESTRICT (the
  decision-B purge shape: rows delete by run, lineage survives).
- Migration `1728000000000-MarketIndexModel.ts` — additive; registered in
  `data-source.ts`; no spec-01 entity or existing migration modified.
- Tests: `market-index-model.spec.ts` (unit lane — entity-shape contract) and
  `market-index-model.int-spec.ts` (testcontainers — full chain up, upsert
  idempotency + stable ids, purge-by-lineage incl. FK RESTRICT, clean
  `undoLastMigration` down). Typecheck + full unit suite (297) + int lane (6)
  green.

Code-review note: initial `MarketIndex ? Sector` CASCADE was changed to
RESTRICT per review (both axes flagged it) — a sector delete must never
silently cascade away an index and its chartable level history.
