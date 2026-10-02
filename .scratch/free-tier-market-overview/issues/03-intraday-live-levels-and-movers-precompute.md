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
