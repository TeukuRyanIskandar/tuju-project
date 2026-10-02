# Build ticket: Screener endpoint (`GET /screener`)

Type: task
Status: resolved
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

- [x] Every spec-03 filter works end-to-end through the endpoint, anonymous.
- [x] Cache: identical screen (parameter-order variants) is served from
      Redis without re-querying; the nightly ingest invalidates it.
- [x] Sort/dir/offset/limit params parse and echo resolved values.
- [x] Integration tests through the composed module (testcontainers
      Postgres + Redis), prior art `search.int.spec.ts`.
- [x] Unit tests for the canonical cache-key normalisation (no containers).

## Out of scope

- `GET /screener/fields` (ticket 03 — parallel agent).
- `app.module.ts` wiring of ticket 03's module (orchestrator, post-wave).

## Answer

Implemented as the endpoint trio in `apps/backend/src/screener/` + the
`ScreenerModule` wiring in `app.module.ts`. All acceptance criteria pinned by
tests; typecheck + build clean; full suite **278/278** across 24 suites
(incl. all testcontainers suites); `test:int` 2/2.

### Files

- `screener.controller.ts` — `@Controller('screener')`, one anonymous `@Get()`
  (deliberately NO `@RequiresJob`, ADR-0005). The 29 filter/sort/page params
  ride ONE whole-`@Query()` object (29 individual `@Query('…')` decorators
  would be unmaintainable), narrowed by the pure picker below.
- `screener.service.ts` — `ScreenerService` (`@Inject(SCREENER_QUERY)` seam +
  `ReadCacheService`): resolve via `parseScreenerQuery`, serve read-through
  `cache:screener:screen:<canonical>`, echo the resolved sort/dir/offset/
  limit. `screenerCacheKey()` — the canonical key: every filter field in a
  fixed order (null = dropped → empty fragment, `true`/`false`/`String(n)`
  otherwise), sorted comma-joined `boards`/`sectorIds` (order-insensitive,
  the disclosures-`key()` posture), then sort/dir/offset/limit always
  emitted at their RESOLVED values — so explicit defaults ≡ omitted params,
  `limit=500` ≡ `limit=100`, rotated lists ≡ sorted originals.
- `params.ts` (+ `rawScreenerParams()` picker, ticket-02 addition) — the
  single home of the HTTP param-name mapping: only the 29 known keys, only
  plain-string values (repeated params / nested objects dropped, never a
  400 — the clamp/drop posture applied before any parsing).
- `screener.module.ts` — the `SearchModule` shape: binds
  `{ provide: SCREENER_QUERY, useClass: PgScreenerQuery }`, composes
  `DataModule` + `CacheModule`, no schedule bits (cron isolation).
- `app.module.ts` — `ScreenerModule` wired with the anonymous-posture
  comment block (spec-03 entry).
- `screener-query.pg.ts` — **bug fix found by this ticket's module wiring**:
  the seam imported `DataSource` type-only (`import type`), so the
  constructor's DI metadata had no runtime token — invisible while the
  ticket-01 spec instantiated it standalone, fatal once `useClass` wiring
  resolved it from the module. Value import now.

### Tests

- `screener-cache-key.spec.ts` (7, unit, no containers): the normalisation
  contract — defaults ≡ omitted, garbage ≡ absent, clamped-pagination
  equivalence, rotated/deduped lists, distinct filters/sorts/pages, and a
  fully-populated exact-key pin of the fixed field order (a future field
  reorder cannot silently collide entries).
- `screener-params.spec.ts` (+3, unit): the `rawScreenerParams` picker —
  keeps the 29 known string params, drops unknown keys / non-string values,
  absent/non-object → empty.
- `screener-endpoint.int.spec.ts` (21, testcontainers Postgres + Redis):
  through the composed module — composition + anonymous posture
  (`REQUIRES_JOB_KEY` undefined, no `ScheduleModule`), default screen
  (echo + %change desc NULLs last), spec-03 row shape w/ provenance, one
  representative filter per class (read-model depth stays in ticket 01's
  32-case suite), sector-by-FK-id, sort/dir/offset/limit echo + clamping,
  cache sharing (rotated list + spelled-out default ≡ one entry, exactly
  one Redis key equal to the unit-pinned canonical key), clamped-pagination
  entry sharing (`limit=500` ≡ `limit=100`), and the nightly-ingest prefix
  sweep forcing a re-query (the ingest side is pinned end-to-end in
  `ingestion.int.spec.ts`).

### Notes

- Response = `ScreenerPage` + `sort`/`dir` echoes (`ScreenerResponse extends
  ScreenerPage`); the page's offset/limit echo back from the cached page
  (safe: they are part of the cache key).
- No invalidation hooks added — ticket 01 already registers the
  `cache:screener:` sweep in `runNightly()` + `purgeUnlicensed()`.
- Key layout `cache:screener:screen:<canonical>` (…`:fields` reserved for
  ticket 03) matches the example keys the ingestion suite already sweeps.
