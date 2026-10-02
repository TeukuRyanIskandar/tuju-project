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
