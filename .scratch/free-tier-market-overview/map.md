# free-tier-market-overview — execution effort (spec 05 implementation)

Breaking [spec 05 — market overview](../free-tier-specs/05-market-overview.md) into
build tickets. Backend only. Ticket work lands in `apps/backend`.

Fixed inputs (do not re-decide): ADR-0001–0012 (esp. ADR-0004 3-class Redis cache,
ADR-0012 dedicated worker), the spec-01 entities/migrations/worker/adapter seam
(all resolved in `free-tier-data`), and the spec-05 decisions (whole-universe
movers option A, cap-weighted `IndexLevel`s behind an `IndexAdapter`, intraday
never touches Postgres).

## Ticket status

| # | Ticket | Wave | Blocked by | Status |
| - | ------ | ---- | ---------- | ------ |
| 01 | [MarketIndex / IndexLevel entities + migration](issues/01-market-index-and-index-level-entities.md) | 1 | — | resolved |
| 02 | [IndexAdapter seam + nightly cap-weighted computation](issues/02-index-adapter-seam-and-nightly-computation.md) | 2 | 01 | resolved |
| 03 | [Intraday live levels + movers precompute in the 5-min replay](issues/03-intraday-live-levels-and-movers-precompute.md) | 3 | 02 | resolved |
| 04 | [Movers endpoint (`GET /market/movers`)](issues/04-movers-endpoint.md) | 4 | 03 | resolved |
| 05 | [Index + sector endpoints (`/market/indices`, `/market/sectors`)](issues/05-index-and-sector-endpoints.md) | 4 | 03 | resolved |

## Wave structure

- **Wave 1:** ticket 01 — the additive model (`MarketIndex`/`IndexLevel`) only:
  entities + migration, no behaviour. Sized alone so the schema change is
  reviewable in isolation (the `free-tier-data` ticket-01 precedent).
- **Wave 2:** ticket 02 — the `IndexAdapter` on the source-adapter seam, the
  `SyntheticIndexAdapter` (cap-weighted, real FBM KLCI methodology), nightly
  computation to Postgres in the worker with `IngestionRun` provenance, and the
  `cache:market:` class-2 prefix + sweep wiring.
- **Wave 3:** ticket 03 — extends the worker's 5-min Redis-only intraday replay
  with live index/sector levels and the precomputed movers boards (class 3,
  never Postgres).
- **Wave 4 (parallel):** ticket 04 (movers endpoint) ∥ ticket 05 (index +
  sector endpoints) — fresh-context sub-agents in their own files, then
  `app.module.ts` wiring + full verification by the orchestrator (the
  screener-effort pattern). Both read the wave-2/3 stores; no file overlap.

## Decisions / notes so far

- Spec 05 is the authority; this map only sequences it. Open spec questions
  (movers floor, official-index licensing, charting/OHLC, anonymous rate
  limits) stay out of scope per the spec's Out-of-Scope section.
- Movers precompute (03) is worker-side; the endpoint (04) is a pure read —
  the spec's "intraday stays Redis-only, never Postgres" rule depends on this
  split.
- The `IndexLevel` series `range` param is the deliberate precedent for the
  still-foggy general OHLC series endpoints (spec 05 Further Notes).
- Ticket 01 resolved: `MarketIndex`/`IndexLevel` entities + migration
  (`1728000000-MarketIndexModel.ts`) landed additively with unit +
  testcontainers tests (up/down, upsert idempotency, purge-by-lineage). Key
  shape choices: `(kind, sector_id)` natural key `NULLS NOT DISTINCT` (headline
  row included), `(index_id, level_date)` level natural key, both run FKs
  RESTRICT, and `MarketIndex → Sector` RESTRICT per the Company→Sector
  precedent (review catch — CASCADE would wipe chartable history).
  - Ticket 02 resolved: `IndexAdapter` (one interface + `INDEX_ADAPTER` token on
  the spec-01 seam) + `SyntheticIndexAdapter` (pure cap-weighted computation,
  FBM KLCI divisor methodology — Σ close × shares normalised to a 100-point
  base at the series' earliest date; free-float adjustment omitted, no float
  data in the demo) + nightly persist ordered after the indicators, own
  `IngestionRun` per nightly (7 runs total), and `cache:market:` swept via the
  new shared `ReadCacheService.invalidateReadCaches()` over
  `READ_CACHE_PREFIXES` (code-review fix — the per-prefix cascade had
  duplicated across ingest + purge). Decisions from the review: the purge
  deletes `MarketIndex` rows too (they're sourced rows with synthetic
  lineage; a `real` licensed index survives), display names carry no
  "(illustrative)" wording (the label is a read-time lineage join, never a
  stored string), and `data.module.ts`'s migration list caught up with
  `data-source.ts` (the DisclosureReadModel gap closed as a side effect of
  the must-stay-in-sync invariant). Idempotency now also pins stable row ids.
- Ticket 03 resolved: the 5-min replay's `replayTick` now also writes the
  class-3 market-overview values — a live cap-weighted level per index
  (`computeLiveIndexLevels` in `index-computation.ts` re-runs the SAME pure
  divisor maths over bars whose last close is substituted with the live tick
  price, and bakes `prevLevel`/`pctChange` into the Redis payload so tickets
  04/05 are single-GET reads) and the three precomputed movers boards
  (`buildMoversBoards` in the new pure `intraday-model.ts`: whole universe,
  gainers/losers by %change desc/asc, actives by cumulative volume, null
  %change last, ties by stockCode — no floor per option A). Decisions from
  the review: the wobble gained a per-instrument phase (a market-wide wobble
  made every %change identical → all-tied boards; this changes spec-01 tick
  prices, which nothing pinned — the phase is the point); actives volume is
  an honest monotonic ramp of the last daily volume × elapsed trading
  fraction (accepted trade-off: actives ORDERING is stable through the day
  and zero at the open — board values still grow every tick); `prevLevel` is
  recomputed from the same generator maths rather than read from Postgres
  (the ADR-0004 no-repository posture; reconciliation with the stored nightly
  series is integration-pinned); the 09:00–16:45 MYT window constants now
  live once in `intraday-model.ts` and are shared by the scheduler guard and
  the volume ramp; `pctChange` stays the one shared definition (imported from
  `stocks/serialisation` in both the model and the service); and the
  `Movers board` glossary term landed in `apps/backend/CONTEXT.md`.
- **Tickets 04 + 05 resolved** (continuing a prior session's interrupted
  draft — the wave-4 file split held, no overlap). Both ride two shared
  seam additions in the ticket-03 files: `intraday-model.ts` now exports a
  pure `isMarketHours(now)` (the scheduler's static method delegates to it)
  and `MOVERS_COMPARATORS` (the three board comparators, keyed by type,
  reused instead of copy-pasted). Decisions from review:
  - **Movers (04):** EOD-fallback provenance reads from the `PriceBar`'s own
    `ingestionRun` (the price data's lineage, `synthetic`), not the
    `Instrument`'s (`real`) — the stock-page `StocksService` precedent for
    splitting identity vs. data-row provenance. The EOD fallback is one
    window-queried SQL round trip (`ROW_NUMBER` + `LEAD` over
    `price_bars` joined to `instruments`/`companies`), and the class-2 cache
    holds the WHOLE sorted board per type (not per `type, limit` pair) —
    `limit` is a read-time slice.
  - **Indices/sectors (05):** the during-hours "Redis only" AC needs the
    index identity fields (id/name/sectorName/provenance — DB-only concepts
    the intraday replay never produces) without a live Postgres read. Rather
    than a new dedicated "index catalog" cache key (the original plan), the
    during-hours read PEEKS the already-existing `cache:market:indices` entry
    (written by the outside-hours path) for those fields and overlays just
    `level`/`pctChange` from the live Redis tick; a cold peek (no
    outside-hours traffic since a flush) gracefully serves an empty panel
    rather than touching Postgres — same posture as an absent movers board.
    `/market/sectors` is now derived from `/market/indices` (filter to
    `kind = sector`) instead of a parallel implementation, so the two can
    never disagree and the Redis-only fix covers both for free. The series
    `range` lookback anchors to the SERIES' OWN latest stored `levelDate`
    (new `seriesSinceDate` in `index-params.ts`), never the wall clock — the
    fixed-date synthetic backfill would otherwise drift out of every range as
    real time passes. A non-UUID `:id` now 404s (a regex check before any
    query) instead of 500ing on a bad Postgres `uuid` cast.
  - **Clock seam:** both endpoints read "now" through a new `MARKET_CLOCK`
    (`() => Date`) DI token bound in `MarketModule` (default: the wall
    clock), not `IngestionScheduler.isMarketHours(new Date())` directly — a
    static-method spy cannot intercept a call made inside a service
    constructed through a different `TestingModule`, which is exactly the
    shape the integration tests need; overriding one provider does.
  - **Integration-test harness fix:** the interrupted draft's `.int.spec.ts`
    files imported `MarketModule` (whose `DataModule` opens its own
    `DATABASE_URL`-driven `DataSource`) while asserting on a separately
    constructed `DataSource` in the test — two different pool instances, so
    every "Postgres untouched" assertion was vacuous (could never fail).
    Rewritten on the `stocks.int.spec.ts` / `disclosures.int.spec.ts` house
    pattern: the controller/service are wired by hand with
    `{ provide: DataSource, useValue: dataSource }`, pointing spies at the
    DataSource the service actually uses.
  - Added the ticket-05 AC's adapter-swap test (a fake `LicensedIndexAdapter`,
    `real` provenance, run through the real nightly ingest on a separate
    harness) — the interrupted draft had an "adapter-swap" test that asserted
    nothing. Also corrected a wrong assumption in that draft: the synthetic
    backfill yields one `IndexLevel` per trading day across the whole ~3-year
    series from a SINGLE nightly ingest (same calendar as the price bars), so
    `pctChange` is a real number immediately, never null.
