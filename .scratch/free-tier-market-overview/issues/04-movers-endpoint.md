# Build ticket: Movers endpoint (`GET /market/movers`)

Type: task
Status: resolved
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

- [x] `type=gainers|losers|actives` (default `gainers`; unknown value drops to
      default, never a 400) and `limit` (default 10, clamped) parse per the
      house posture.
- [x] Ordering per board: %change desc (gainers), asc (losers), volume
      (actives); ties deterministic.
- [x] **Source selection by the market-hours clock:** during hours the read
      hits Redis only (Postgres untouched — integration-pinned); outside
      hours it reads the EOD fallback through the class-2 cache.
- [x] Rows carry provenance → synthetic rows labelled "illustrative".
- [x] Endpoint is anonymous; module wired into the app per the house
      controller/service/module pattern.
- [x] Unit lane: param parsing, no containers. Integration lane
      (testcontainers Postgres + Redis): seeded universe, ordering, clock
      selection, cache-class behaviour. Typecheck + full suite green.

## Out of scope (later tickets under this effort)

- Index + sector endpoints (ticket 05).
- Movers floor, anonymous rate-limit posture — spec 05 Out of Scope.

## Resolution notes

Finished a prior session's interrupted draft; the shape (controller/service/
module/params) was already right, but review turned up real defects, fixed
here:

- **Provenance was wrong.** The draft read it from the `Instrument` row
  (`real`), not the `PriceBar` run that actually produced the illustrative
  prices (`synthetic`) — the same identity-vs-data-row split the stock-page
  `StocksService` already makes for its technicals block.
- **The EOD fallback is now one SQL round trip**, not a "load every bar for
  the universe, group in JS" scan: a window query (`ROW_NUMBER` for the
  latest bar, `LEAD` for the %change basis) over `price_bars ⋈ instruments ⋈
  companies`, filtered to the analysed universe inline (`c.board IN ('MAIN',
  'ACE')` — the `screener-query.pg.ts` precedent for a fixed-board literal,
  not a bind parameter).
- **The class-2 cache now holds the WHOLE sorted board per type**, not one
  entry per `(type, limit)` — `limit` is a read-time slice of the cached
  board, so `?limit=3` and `?limit=50` share one cache entry instead of
  fragmenting the cache.
- **The "during hours" integration tests were vacuous.** The draft's
  `.int.spec.ts` imported `MarketModule` (which opens its OWN
  `DATABASE_URL`-driven `DataSource` via `DataModule`) and then spied on the
  TEST's own separately-constructed `DataSource` — two different pool
  instances, so the "Postgres untouched" assertions could never fail even if
  the code touched Postgres. Rewritten on the `stocks.int.spec.ts` /
  `disclosures.int.spec.ts` house pattern: `{ provide: DataSource, useValue:
  dataSource }` wires the controller/service directly to the SAME DataSource
  the test spies on.
- **The market-hours clock is now a DI seam** (`MARKET_CLOCK`, a `() => Date`
  token bound in `MarketModule`; defaults to the wall clock), not a call to
  `IngestionScheduler.isMarketHours(new Date())`. A static-method spy cannot
  intercept a call made inside a service constructed through a *different*
  `TestingModule`, which is exactly the shape every integration test needs;
  overriding one provider does intercept it. `IngestionScheduler.isMarketHours`
  now delegates to the same pure `isMarketHours` the service calls
  (`intraday-model.ts`) — one guard, shared by the write side (replay) and
  the read side (this endpoint).
- The board comparators (`gainers`/`losers`/`actives`) are now exported from
  `intraday-model.ts` as `MOVERS_COMPARATORS` and reused here, rather than a
  second copy-pasted comparator set that could silently drift from the
  ticket-03 precompute's ordering.
- Fixed a wrong unit-test expectation (`movers-params.spec.ts`): `limit=0`
  drops to the default (not a positive-integer floor of 1) — matches the
  parser's actual, correct behaviour.
- Seeded universe now includes a LEAP instrument with the largest mover/volume
  numbers, pinning that it's excluded (the analysed universe is MAIN/ACE
  only) — the prior draft's seed had no non-MAIN/ACE row to exercise that
  filter at all.
