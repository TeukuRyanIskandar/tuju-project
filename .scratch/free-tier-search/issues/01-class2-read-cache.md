# Build ticket: Class-2 read-through cache + ingest invalidation hooks

Type: task
Status: resolved
Blocked by: (none)

> Execution effort breaking down
> [spec 02 — search + stock page](../../free-tier-specs/02-search-and-stock-page.md).
> Wave 1 — the shared ADR-0004 **cache class 2** seam every spec-02 endpoint
> (and specs 03–05 after it) reads through. Fixed inputs: ADR-0004 (Redis
> read-through cache, rebuildable, key-prefix separation), ADR-0006 (config by
> env), ADR-0010 (structured logging).

## Scope (this ticket only)

A small `ReadCacheService` in a new `apps/backend/src/cache/` module, plus the
invalidation hooks on the spec-01 ingest paths. No endpoint consumes it yet
(tickets 02/03 do).

### ReadCacheService

- Built on the existing `REDIS_CLIENT` (`src/redis/redis.module.ts`) — the same
  shared Redis instance, separated by key prefix (ADR-0004).
- Key prefix **`cache:`** (separate from BullMQ + the session store prefixes).
- API: `get<T>(key)` (JSON round-trip, `null` on miss), `set(key, value, ttl)`
  (serialise + `SET ... EX`), `del(key)`, and **`invalidatePrefix(prefix)`** —
  delete every key under a prefix (SCAN + DEL, never `KEYS`).
- A read-through convenience `remember(key, ttl, loader)` wrapping get →
  loader → set is welcome but optional; keep the service small.
- TTL: constructor default constant (24h class-2 EOD-derived horizon); allow
  per-call override. No new env var unless simple (`READ_CACHE_TTL_SECONDS`
  optional override is fine).
- Everything in it is **cold-rebuildable from Postgres** (ADR-0004: a rebuildable
  cache; losing it is never data loss).

### Invalidation hooks (cache class 2 rules)

- **Nightly ingest:** after the `runNightly()` transaction **commits** (never
  inside the transaction callback), invalidate `cache:search:*` and
  `cache:stocks:*`. Implementation: `EodIngestService.runNightly()` gets the
  `ReadCacheService` injected and invalidates after the `dataSource.transaction`
  promise resolves; a failure to invalidate must fail the ingest loudly (throw)
  — a stale "illustrative" page after new data landed is worse than a retried
  ingest.
- **Decision-B purge:** `PurgeService.purgeUnlicensed()` invalidates the same
  prefixes after its transaction commits (same reasoning).
- Keep the prefix constants (`SEARCH_CACHE_PREFIX`, `STOCKS_CACHE_PREFIX`) in
  `src/cache/` and export them — tickets 02/03 key through them.

## Out of scope (later tickets under this effort)

- The `/search` and `/stocks/:code` endpoints + their cache keys (tickets 02/03).
- Class-3 Redis-only intraday data (spec 05).
- Any class-1 (AI job result) caching.
- Rate limiting / abuse posture (cross-cutting fog).

## Testing seam (TDD)

- Unit tests with a **mocked Redis client** (no container in the unit lane for
  this ticket): JSON round-trip fidelity (`null`/`undefined`/nested objects),
  TTL passed to `SET`, prefix invalidation issues SCAN+DEL (never `KEYS`).
- Invalidation-wiring tests: spy on `ReadCacheService.invalidatePrefix` and
  assert `runNightly()` calls it with both prefixes **after** the transaction
  resolves (the spy's call ordering vs the persisted rows), and that
  `purgeUnlicensed()` does the same.
- ADR-0010: no plain interpolated log strings in the new code.

## Answer

Implemented as `apps/backend/src/cache/` — the first ADR-0004 class-2 consumer
in the codebase and the pattern specs 03–05 will reuse.

### Files

- `cache-keys.ts` — the invalidation units: `READ_CACHE_KEY_PREFIX` (`cache:`),
  `SEARCH_CACHE_PREFIX` (`cache:search:`), `STOCKS_CACHE_PREFIX` (`cache:stocks:`).
- `read-cache.service.ts` — `get`/`set`/`del`/`remember(key, loader, ttl)` with
  JSON round-trip; `SET … EX` TTL form; default TTL 24h (optional positive
  integer env override `READ_CACHE_TTL_SECONDS`, garbage ignored);
  `invalidatePrefix` — SCAN (never `KEYS`) collecting the full deduped match
  set FIRST, then one DEL (deleting per page would shift SCAN cursors and skip
  keys); refuses any prefix outside `cache:` so a stray call can never sweep
  the BullMQ/session keyspace; one structured log line (ADR-0010) when it
  deletes. `remember` never caches an `undefined` loader result; exceptions
  propagate uncached (404s stay uncached by throwing through the loader).
- `cache.module.ts` + `index.ts` — plain (non-global) module, exported service.

### Invalidation hooks (post-commit, fail-loud)

- `EodIngestService.runNightly()` — after the transaction resolves, sweep
  `cache:search:` + `cache:stocks:`; an invalidation failure fails the ingest.
- `PurgeService.purgeUnlicensed()` — same sweep after its commit.
- `IngestionModule` imports `CacheModule` (worker context resolves the service).

### Tests

- `src/cache/read-cache.spec.ts` (8, unit, mocked Redis): JSON round-trip
  fidelity + null-on-miss, EX TTL args, env-override parsing, `remember`
  hit/miss/undefined semantics, `del`, prefix invalidation via SCAN with MATCH
  (never `KEYS`), refusal outside `cache:`.
- `src/ingestion/ingestion.int.spec.ts` (4th test, real Postgres+Redis
  containers): stale keys under both prefixes are swept by a second nightly
  ingest AND by the purge, while a key outside the prefixes survives. Note: the
  test clears the `real` shariah/IPO tables before its second nightly because
  the purge keeps them and the demo adapters' static snapshots re-insert —
  a pre-existing demo-adapter idempotency quirk (spec-01 scope), not a
  regression.

### Verification

typecheck clean; full suite green (this effort: 145/145 incl. containers).
