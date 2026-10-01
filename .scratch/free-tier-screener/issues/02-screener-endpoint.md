# Build ticket: Screener endpoint (`GET /screener`)

Type: task
Status: ready-for-agent
Blocked by: 01

> Wave 2 of the spec-03 execution effort breaking down
> [spec 03 — screener](../../free-tier-specs/03-screener.md).

## What to build

The anonymous `GET /screener` endpoint over ticket 01's `ScreenerQuery` seam:
controller + service in `src/screener/`, raw query params parsed via the
ticket-01 `params.ts` helpers (clamp/drop, never a 400), results served
through the class-2 `ReadCacheService` under `cache:screener:`, keyed by the
**canonical normalised filter+sort+page params** (deterministic key: dropped
defaults, order-insensitive lists, resolved clamped pagination) so equivalent
requests share one entry. Deliberately no `@RequiresJob` (anonymous free-tier
browse, ADR-0005). Wired into `app.module.ts`.

## Acceptance criteria

- [ ] Every spec-03 filter works end-to-end through the endpoint, anonymous.
- [ ] Cache: identical screen (parameter-order variants) is served from
      Redis without re-querying; the nightly ingest invalidates it.
- [ ] Sort/dir/offset/limit params parse and echo resolved values.
- [ ] Integration tests through the composed module (testcontainers
      Postgres + Redis), prior art `search.int.spec.ts`.
- [ ] Unit tests for the canonical cache-key normalisation (no containers).

## Out of scope

- `GET /screener/fields` (ticket 03 — parallel agent).
- `app.module.ts` wiring of ticket 03's module (orchestrator, post-wave).
