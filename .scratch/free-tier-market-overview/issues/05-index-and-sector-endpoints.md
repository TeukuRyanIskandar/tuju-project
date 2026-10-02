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
