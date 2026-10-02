# Build ticket: Index + sector endpoints (`GET /market/indices`, `/market/indices/:id/series`, `/market/sectors`)

Type: task
Status: resolved
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

- [x] `/market/indices` returns headline + sector indices with level,
      `%change`, and per-index provenance (synthetic → "illustrative");
      source selection by the market-hours clock (live Redis vs latest stored).
- [x] `/market/indices/:id/series` returns the stored daily series from
      Postgres; `range` clamps/drops (never a 400); unknown id → the house
      not-found shape.
- [x] `/market/sectors` returns per-sector `%change` consistent with the
      headline index (same machinery, cap-weighted, no request-time
      aggregation).
- [x] Cache-class behaviour pinned: intraday reads hit Redis only; series
      reads hit Postgres via the class-2 read-through.
- [x] Adapter-swap posture holds: consumers read `IndexLevel` identically
      regardless of which adapter produced it (fake `LicensedIndexAdapter`
      test).
- [x] Endpoints are anonymous; module wired into the app.
- [x] Unit lane: param/range parsing. Integration lane (testcontainers
      Postgres + Redis): seeded series, clock selection, provenance,
      cache-class behaviour. Typecheck + full suite green.

## Out of scope (this effort done after this ticket)

- Index chart component / overlays — frontend; only the series *data*
  endpoint is in scope (spec 05).
- Movers endpoint (ticket 04). Movers floor, official-index licensing,
  general OHLC series, anonymous rate-limit posture — spec 05 Out of Scope.

## Resolution notes

Finished a prior session's interrupted draft alongside ticket 04. Two real
defects turned up on review, both now fixed:

- **"Intraday reads hit Redis only" was broken.** The draft's during-hours
  path still queried `MarketIndex` from Postgres on every call (for the id/
  name/sectorName/provenance identity fields) before overlaying the live
  Redis level — a genuine Postgres hit on the supposedly Redis-only path.
  Fixed by having the during-hours read PEEK the last-cached OUTSIDE-hours
  response (`readCache.get`, never a loader) for those identity fields —
  they only change on a nightly ingest, which sweeps that very cache key, so
  reusing it is always correct, never stale — and overlay just `level`/
  `pctChange` from the live Redis tick. A cold cache (no outside-hours
  traffic since a Redis flush) now returns an empty panel rather than
  touching Postgres, the same graceful-empty posture ticket 03/04 already
  established for an absent movers board; in practice the cache warms during
  the ~13h closed window before every market open. No separate "index
  catalog" cache entry was needed — reusing the existing `cache:market:indices`
  entry for this was simpler than the originally planned dedicated catalog
  key.
- **`/market/sectors` is now derived from `/market/indices`**, not a
  parallel Redis/Postgres implementation — filtering the sector-kind entries
  of the exact same call means the two surfaces share one cache entry and
  one live-overlay path and can never disagree, and fixes the same
  Redis-only defect for sectors for free.
- **`range` was anchored to the wall clock**, so `1m`/`3m`/`1y` etc. drift
  out of the fixed-date synthetic backfill as real time passes (an empty
  `1m` well before `all` goes empty). `resolveSeriesRange` now returns
  `{ range, days }` only; a new `seriesSinceDate(latestLevelDate, days)`
  anchors the lookback to the SERIES' OWN latest stored `levelDate` instead
  — correct for a fixed historical backfill and for a real feed's own
  trading calendar alike.
- **A non-UUID `:id` 500'd** (a bad Postgres `uuid` cast) instead of the
  house 404; now checked with a UUID-shape regex before any query, so the
  controller's dead `try { … } catch { throw err }` could also come out.
- **The "during hours"/cache integration tests were vacuous** for the same
  reason as ticket 04 (the draft's `.int.spec.ts` imported `MarketModule`,
  which opens its own `DataSource`, and spied on a different one) — rewritten
  on the `stocks.int.spec.ts` house pattern, plus a genuine
  `MARKET_CLOCK`-driven clock seam (see ticket 04 notes) instead of a static
  spy.
- **Added the adapter-swap test the AC asked for**: a `FakeLicensedIndexAdapter`
  (`real` provenance, fixed known levels) run through the real nightly ingest
  on a SEPARATE Postgres+Redis harness, then asserting `/indices`,
  `/indices/:id/series`, and `/sectors` all serve those exact values through
  the unchanged read surface. The prior draft's "adapter-swap" test asserted
  nothing about provenance or values.
- Also discovered while pinning the pctChange test: the synthetic backfill
  produces one `IndexLevel` per TRADING DAY across the whole ~3-year
  backfill (same calendar as the price bars), not "one level per ingest" —
  so `pctChange` is a real number from the very first nightly ingest, never
  null. The draft's test comment asserting otherwise was wrong.
