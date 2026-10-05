# Plan: tickets for spec 05 (market overview)

Approved breakdown (user chose 5 tickets: ticket 01 split into entities vs
computation; structure otherwise as presented). On approval, write these five
files verbatim under `.scratch/free-tier-market-overview/` (issues dir) plus
`map.md`, then report the tracker summary.

---

## File 1: `.scratch/free-tier-market-overview/map.md`

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
| 01 | [MarketIndex / IndexLevel entities + migration](issues/01-market-index-and-index-level-entities.md) | 1 | — | ready-for-agent |
| 02 | [IndexAdapter seam + nightly cap-weighted computation](issues/02-index-adapter-seam-and-nightly-computation.md) | 2 | 01 | ready-for-agent |
| 03 | [Intraday live levels + movers precompute in the 5-min replay](issues/03-intraday-live-levels-and-movers-precompute.md) | 3 | 02 | ready-for-agent |
| 04 | [Movers endpoint (`GET /market/movers`)](issues/04-movers-endpoint.md) | 4 | 03 | ready-for-agent |
| 05 | [Index + sector endpoints (`/market/indices`, `/market/sectors`)](issues/05-index-and-sector-endpoints.md) | 4 | 03 | ready-for-agent |

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

---

## File 2: `.scratch/free-tier-market-overview/issues/01-market-index-and-index-level-entities.md`

# Build ticket: MarketIndex / IndexLevel entities + migration

Type: task
Status: ready-for-agent
Blocked by: (none — spec 01 is fully resolved)

> Wave 1 of the spec-05 execution effort breaking down
> [spec 05 — market overview](../../free-tier-specs/05-market-overview.md).
> Fixed inputs: ADR-0001–0012, the spec-01 entities/migrations in
> `apps/backend/src/data/entities/` (additive only — redefined nothing), and the
> glossary entries already in `apps/backend/CONTEXT.md`.

## What to build

The additive model pair spec 05 introduces — nothing else, no behaviour:

1. **`MarketIndex`** — a reference entity naming an index: the FBM KLCI
   analogue headline index plus one index per Bursa `Sector` (a `kind`
   discriminator: headline vs sector, with the sector FK on the sector rows).
   Membership is derived, not stored: headline = the whole analysed universe
   (Main+ACE ordinary shares), a sector index = that sector's instruments.
2. **`IndexLevel`** — one level per index per day (a daily series parallel to
   price bars, so an index is chartable), FK-ing its `IngestionRun` for
   provenance lineage (lineage, not a per-row marker — the ticket-10-of-
   free-tier decision). Natural-key upsert (`(index, date)`) per the
   re-ingest-idempotency lesson from `free-tier-data` ticket 05.

Entities + migration only — no adapter, no computation, no reads (tickets 02–05).

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
  series, anonymous rate-limit posture — spec 05 Out of Scope.

---

## File 3: `.scratch/free-tier-market-overview/issues/02-index-adapter-seam-and-nightly-computation.md`

# Build ticket: IndexAdapter seam + nightly cap-weighted computation

Type: task
Status: ready-for-agent
Blocked by: 01 (entities + migration)

> Wave 2 of the spec-05 execution effort. Fixed inputs: the ticket-01 entities,
> the spec-01 source-adapter seam (one interface per data class + DI tokens,
> demo impls behind DI — `free-tier-data` ticket 02), the spec-01 worker
> (crons, `IngestionRun`/`SyntheticRun` lineage, ADR-0012), ADR-0004
> (class-2 read cache, key-prefix separation).

## What to build

The index machinery that makes a stored, chartable, provenance-honest index
series exist — verifiable end-to-end by running the worker's nightly ingest
(one-shot command) and reading the levels back:

1. **`IndexAdapter` on the source-adapter seam:** one interface + DI token,
   same shape as the spec-01 adapter classes; demo implementation
   `SyntheticIndexAdapter` (provenance class `synthetic`) cap-weighting the
   synthetic constituent bars using the real FBM KLCI methodology. Production
   is a swap: `LicensedIndexAdapter` ingesting a licensed feed (`real`) or a
   house recompute over real prices — identical entities and consumers either
   way (the seam is the demo/production boundary).
2. **Nightly computation in the worker, ordered after the EOD ingest:** for each
   `MarketIndex` (headline + every sector), compute the cap-weighted level from
   that day's constituent bars and persist one `IndexLevel` per index per day
   with `IngestionRun` lineage. Idempotent on re-ingest (ticket-01 natural keys).
3. **Purge + cache wiring:** synthetic `IndexLevel`s are deleted by the
   decision-B purge (by lineage, like the other synthetic data classes); a
   `cache:market:` prefix (`cache:market:`) joins the read-cache key constants
   and is swept fail-loud by the nightly ingest and the purge, same as the
   search/stocks/disclosures/screener prefixes.

## Acceptance criteria

- [ ] Cap-weighted level over synthetic constituents matches the expected
      weighted sum (test with known bars); the per-sector index scopes to its
      sector's constituents only.
- [ ] Nightly ingest lands one `IndexLevel` per index per day in Postgres,
      ordered after EOD; a second nightly run updates in place (no duplicate
      rows, stable ids).
- [ ] Synthetic levels carry `synthetic` provenance via lineage → surface as
      "illustrative"; the decision-B purge deletes exactly the synthetic
      levels and leaves lineage rows.
- [ ] `cache:market:` prefix exists, swept by nightly + purge (integration-
      pinned, same test shape as the existing prefixes); keys outside the
      prefixes survive.
- [ ] `IndexAdapter` is a seam swap: a fake `LicensedIndexAdapter` producing
      `real` levels feeds identical consumers (adapter-swap test).
- [ ] Worker one-shot command computes + persists indices (demoable without
      waiting for the cron).
- [ ] Integration via testcontainers Postgres (ADR-0011); typecheck + full
      suite green.

## Out of scope (later tickets under this effort)

- Live intraday levels + movers precompute in the 5-min replay (ticket 03).
- All `GET /market/*` endpoints (tickets 04, 05).
- FBM KLCI licensing for production display — architecture map's
  vendor-verification task (spec 05 Out of Scope).

---

## File 4: `.scratch/free-tier-market-overview/issues/03-intraday-live-levels-and-movers-precompute.md`

# Build ticket: Intraday live levels + movers precompute in the 5-min replay

Type: task
Status: ready-for-agent
Blocked by: 02 (adapter + cap-weighted computation)

> Wave 3 of the spec-05 execution effort. Fixed inputs: the spec-01 worker's
> 5-min intraday-replay cron (09:00–16:45 MYT guard, Redis-only, short-TTL
> keys, no repository/transaction), the ticket-02 index machinery, ADR-0004
> ("intraday never touches Postgres" — class 3).

## What to build

Extends the worker's existing 5-min Redis-only intraday replay so the live
market-overview values exist in Redis at every tick — verifiable by running
the replay (one-shot command) and inspecting Redis:

1. **Live index levels (class 3):** on each tick, recompute the live
   cap-weighted level for the headline index and every sector index from the
   current intraday prices and write them to Redis only (same key shape/TTL
   posture as the existing per-instrument ticks).
2. **Movers precompute (class 3):** on each tick, precompute the three movers
   boards over the whole analysed universe — gainers and losers by `%change`,
   actives by volume, **no liquidity/market-cap floor** (spec option A) — and
   write them to Redis only, so the read endpoint is a pure read.

Nothing lands in Postgres from this path — no repository, no transaction, no
new nightly cadence (nightly is ticket 02's).

## Acceptance criteria

- [ ] After a replay tick, Redis holds a live level per index (headline +
      sectors) and the three precomputed movers boards.
- [ ] **Postgres row counts are unchanged by the replay** (the ADR-0004
      invariant, integration-pinned — the spec-01 test shape).
- [ ] Movers ordering: gainers/losers by `%change` desc/asc, actives by volume,
      over the whole analysed universe (no floor, no filtering).
- [ ] Boards update on each tick through the trading-day window (09:00–16:45
      MYT guard respected — no writes outside hours).
- [ ] Market-hours guard bounds the extended replay exactly as it bounds the
      existing per-instrument replay.
- [ ] Integration via testcontainers Postgres + Redis; typecheck + full suite
      green.

## Out of scope (later tickets under this effort)

- All `GET /market/*` endpoints, including the EOD-close fallback reads
  outside hours (tickets 04, 05).
- Movers liquidity/market-cap floor — spec 05 Out of Scope (option A accepted).

---

## File 5: `.scratch/free-tier-market-overview/issues/04-movers-endpoint.md`

# Build ticket: Movers endpoint (`GET /market/movers`)

Type: task
Status: ready-for-agent
Blocked by: 03 (precomputed boards + live replay)

> Wave 4 of the spec-05 execution effort (parallel with ticket 05 — own files,
> no overlap). Fixed inputs: the ticket-03 Redis boards, spec-01 EOD bars,
> ADR-0004 cache classes (intraday-live = class 3 Redis-only; EOD-derived =
> class 2 read-through), the house param posture (clamp/drop, never a 400).

## What to build

`GET /market/movers?type=gainers|losers|actives&limit=` (default 10, anonymous)
— the "what's moving today" panel, demoable end-to-end via curl against a
running replay or a nightly-ingested DB:

- **During market hours:** a pure read of the ticket-03 precomputed board from
  Redis (class 3) — never Postgres.
- **Outside hours:** the EOD-close fallback — top gainers/losers/actives
  computed from the latest stored EOD closes (class 2, read-through
  `cache:market:`).
- Rows carry provenance (synthetic → "illustrative"), same labelling posture as
  the other read endpoints.

## Acceptance criteria

- [ ] `type=gainers|losers|actives` (default `gainers`; unknown value drops to
      default, never a 400) and `limit` (default 10, clamped) parse per the
      house posture.
- [ ] Ordering per board: %change desc (gainers), asc (losers), volume
      (actives); ties deterministic.
- [ ] **Source selection by the market-hours clock:** during hours the read
      hits Redis only (Postgres untouched — integration-pinned); outside
      hours it reads the EOD fallback through the class-2 cache.
- [ ] Rows carry provenance → synthetic rows labelled "illustrative".
- [ ] Endpoint is anonymous; module wired into the app per the house
      controller/service/module pattern.
- [ ] Unit lane: param parsing, no containers. Integration lane
      (testcontainers Postgres + Redis): seeded universe, ordering, clock
      selection, cache-class behaviour. Typecheck + full suite green.

## Out of scope (later tickets under this effort)

- Index + sector endpoints (ticket 05).
- Movers floor, anonymous rate-limit posture — spec 05 Out of Scope.

---

## File 6: `.scratch/free-tier-market-overview/issues/05-index-and-sector-endpoints.md`

# Build ticket: Index + sector endpoints (`GET /market/indices`, `/market/indices/:id/series`, `/market/sectors`)

Type: task
Status: ready-for-agent
Blocked by: 03 (live levels + stored series from 01/02 transitively)

> Wave 4 of the spec-05 execution effort (parallel with ticket 04 — own files,
> no overlap). Fixed inputs: the ticket-01/02 stored `IndexLevel` series +
> provenance, the ticket-03 live Redis levels, ADR-0004 cache classes, the
> house param posture.

## What to build

The index panel + sector board, demoable end-to-end via curl:

1. **`GET /market/indices`** — headline + sector indices, current level +
   `%change`, with `provenance`: live level from Redis (class 3) during market
   hours; latest stored `IndexLevel` from Postgres (class 2) otherwise.
2. **`GET /market/indices/:id/series?range=`** — the stored `IndexLevel` history
   for one index (Postgres, class 2) — the chartable sparkline data. The
   `range` param follows the house clamp/drop posture and is the deliberate
   precedent for the still-foggy general OHLC series endpoints.
3. **`GET /market/sectors`** — the sector-performance board: per-`Sector`
   `%change` from that sector's index (live from Redis during hours, latest
   stored otherwise). No request-time aggregation — sector indices are
   first-class `MarketIndex` rows.

## Acceptance criteria

- [ ] `/market/indices` returns headline + sector indices with level,
      `%change`, and per-index provenance (synthetic → "illustrative");
      source selection by the market-hours clock (live Redis vs latest stored).
- [ ] `/market/indices/:id/series` returns the stored daily series from
      Postgres; `range` clamps/drops (never a 400); unknown id → the house
      not-found shape.
- [ ] `/market/sectors` returns per-sector `%change` consistent with the
      headline index (same machinery, cap-weighted, no request-time
      aggregation).
- [ ] Cache-class behaviour pinned: intraday reads hit Redis only; series
      reads hit Postgres via the class-2 read-through.
- [ ] Adapter-swap posture holds: consumers read `IndexLevel` identically
      regardless of which adapter produced it (fake `LicensedIndexAdapter`
      test).
- [ ] Endpoints are anonymous; module wired into the app.
- [ ] Unit lane: param/range parsing. Integration lane (testcontainers
      Postgres + Redis): seeded series, clock selection, provenance,
      cache-class behaviour. Typecheck + full suite green.

## Out of scope (this effort done after this ticket)

- Index chart component / overlays — frontend; only the series *data*
  endpoint is in scope (spec 05).
- Movers endpoint (ticket 04). Movers floor, official-index licensing,
  general OHLC series, anonymous rate-limit posture — spec 05 Out of Scope.
