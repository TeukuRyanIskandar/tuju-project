# free-tier-search — execution effort (spec 02 implementation)

Breaking [spec 02 — search + stock page](../free-tier-specs/02-search-and-stock-page.md)
into build tickets. Backend only. Ticket work lands in `apps/backend`.

## Ticket status

| # | Ticket | Wave | Blocked by | Status |
| - | ------ | ---- | ---------- | ------ |
| 01 | [Class-2 read-through cache + ingest invalidation hooks](issues/01-class2-read-cache.md) | 1 | — | **resolved** (working tree, uncommitted) |
| 02 | [Search endpoint (`GET /search?q=`)](issues/02-search-endpoint.md) | 2 | 01 | **resolved** (working tree, uncommitted) |
| 03 | [Stock page core + disclosure lists](issues/03-stock-page-and-lists.md) | 2 | 01 | **resolved** (working tree, uncommitted) |

All tickets resolved; specs 02's implementation is complete and verified
(typecheck clean; **145/145** tests across 15 suites incl. the testcontainers
integration suites; `test:int` 2/2; build clean). Everything is in the working
tree, **uncommitted**, pending user review.

## Wave structure

- **Wave 1 (done):** ticket 01 — the shared class-2 read-through cache seam (the first
  ADR-0004 class-2 consumer in the codebase; specs 03–05 reuse it) + the
  invalidation hooks on nightly ingest and purge.
- **Wave 2 (done, parallel):** ticket 02 (search) ∥ ticket 03 (stock page + lists) —
  fresh-context sub-agents in their own dirs, then `app.module.ts` wiring,
  full verification, and an independent audit by the orchestrator.

## Decisions / notes so far

- **No new migration.** Spec 02 says the `pg_trgm` GIN index migration is "owned
  by this build" — but spec-01 ticket 01's boot migration already created the
  trigram GIN indexes on `instruments.short_name`/`full_name`
  (`1727700000000-FreeTierDomainModel.ts`). The spec's intent is satisfied; this
  effort adds no migration.
- **Spec-04 dependency satisfied "alongside"** (per the specs README build
  order): announcements + corporate actions are read directly from the spec-01
  entities (`Announcement`, `CorporateAction` — already ingested nightly by the
  spec-01 worker with `aggregator` lineage). Spec 02 references spec 04's
  taxonomy/fields; it redefines nothing.
- **%change is read-time** from the two latest `PriceBar`s (the EOD snapshot,
  not the 5-min replay; spec 02 "Header close/%change is the EOD snapshot").
  `IndicatorSnapshot.latestClose` is the close; the previous close comes from
  the last two bars. Entities stay untouched — this is a pure read layer.
- **`lossMaking`** derived at read time from `FundamentalsSnapshot.ttmEps <= 0`
  (P/E is already null there per ticket-10 semantics — "N/A (loss-making)").
- **Provenance per block** is a read-time `IngestionRun` lineage join on each
  block's source row: identity/Shariah → `real`, fundamentals/technicals →
  `synthetic`, announcements/corporate-actions → `aggregator`.
- **One invalidation point covers both cache triggers**: in the demo, the
  disclosure snapshot lands inside the same nightly `runNightly()` transaction
  as the EOD prices, so invalidating `cache:search:*` + `cache:stocks:*` once
  after the transaction commits covers the nightly-ingest AND
  disclosure-ingest invalidations. The decision-B purge also invalidates (its
  deletes change what the cached pages would show).
- **Entities + migrations are NOT modified** by any ticket. `app.module.ts` is
  wired by the orchestrator after wave 2 (sub-agents don't touch it, avoiding
  parallel-edit conflicts).

## Audit (independent, post-implementation)

PASS on both axes (Spec + Standards), zero violations, five nits. Two nits
were fixed immediately:

- LIKE/ILIKE metacharacters in the search query are now escaped
  (`escapeLikePattern()`) with two new ranking cases (`1_5`, `1%5` must not
  wildcard-match `1155`).
- Disclosure-list ordering got deterministic `id` tiebreakers (`filedAt DESC,
  id DESC`; `exDate ASC, id ASC`) so equal-timestamp rows cannot shuffle
  across pages.

Three nits accepted as-is (recorded, not blocking):

- **`sectorName` (search row) vs `sector` (stock-page identity block)** — two
  different payloads, both stable contracts; renaming now would ripple for no
  functional gain. FE maps both spellings.
- **Fuzzy band hard-codes `0.3`** instead of reading the
  `pg_trgm.similarity_threshold` GUC — it duplicates pg_trgm's default exactly
  and is documented; revisit only if the GUC is ever tuned.
- **Map/ticket bookkeeping lagged the code** — closed out (this update).

## Latent quirk surfaced by the cache-integration test (spec-01 scope, NOT this effort)

Running `runNightly()` twice against one DB fails the whole ingest — the demo
adapters' static snapshots re-insert the same rows and the `real` shariah rows
(survivors of the decision-B purge) collide on
`UQ_shariah_statuses_company_effective`; the fundamentals/indicator snapshots
collide next, and the non-unique tables would duplicate. The cache test works
around it by clearing the shariah + IPO tables first. **Filed as a ticket on
the spec-01 effort: [free-tier-data ticket 05 — nightly re-ingest
idempotency](../free-tier-data/issues/05-nightly-reingest-idempotency.md)**
(full findings, impact — the nightly cron breaks from night 2 on a persistent
DB — and fix options). Not a read-layer defect.
