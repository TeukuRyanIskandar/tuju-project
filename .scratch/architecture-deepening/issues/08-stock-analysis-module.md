# Stock analysis module (write + read + artifact proxy)

Status: resolved
Strength: Speculative
Dependency category: local-substitutable + mock S3
Blocked by: 01, 04

## Files
- `stocks/stocks.service.ts` (`loadTechnicalAnalysis`/`loadFundamentalAnalysis` 455–478, `loadArtifact` 543)
- `stocks/stock-analysis-read.ts`, `analysis/*-analysis.store.ts`, `ipo/ipo.service.ts:84`

## Problem
`StocksService` reads the TA/FA repositories directly and bypasses the stores. Stale promotion happens inside a 1h cache, so a stale status is itself cached. Two S3 artifact proxies exist.

## Direction
A `StockAnalysis` module owns pending/ready/stale/failed for both writes and reads, plus a shared artifact proxy. Its interface is `status(code, kind)`, `artifact(code, kind)` and `markPending(...)`. Stale promotion happens outside the cached payload.

## Tests
pending → ready → stale → failed through one interface (Postgres plus an S3 fake).

## Comments

**2026-10-12, implemented (uncommitted on `refactor/architecture-deepening`).**

- Module: `analysis/stock-analysis.ts` (`StockAnalysis`, replaces `StockAnalysisStore`). Interface: `status(code, kind)` (thin envelope, `pending` without a row, read-time `stale`), `artifact(code, kind)` (S3 proxy, `cost` stripped), `markPending(jobName, instrument, {correlationId, jobId}) → boolean`, `findByInstrumentId` (the enqueuer's same-day skip), and the JobFamily `land`/`fail`. Pure mapping lives in `analysis/stock-analysis-envelope.ts` (internal).
- `StocksService` delegates the four TA/FA methods and no longer injects the TA/FA repositories or S3. `StocksModule` imports `AnalysisModule` (which now imports `S3Module` and the `PriceBar` repo) and drops `S3Module`.
- Shared artifact proxy: `s3/artifact-proxy.ts` (`readArtifactJson(s3, pointer, emptyMessage)`), used by `StockAnalysis.artifact` and `IpoService.getArtifact`. IPO's HTTP behaviour is unchanged: same 404s, `cost` kept, still read through its class-2 cache.
- Caching: restored. The class-2 entry `stockAnalysis(code, kind)` holds the envelope as written, with no promotion. `stale` is applied after the cache, using one indexed query for the latest price bar, and only when the cached status is `ready`/`facts_only`. Staleness therefore follows the price bars live and does not depend on `eodIngested` invalidation. `markPending`, `land` and `fail` all announce `stockAnalysisChanged`. `artifact()` reads its pointer from the same cached envelope. The cached value keeps the old envelope shape, so an older cache entry is still valid.
- Race fix (within this module): `markPending` is a conditional `UPDATE … WHERE correlation_id <> :cid OR status = 'pending'`, then `INSERT … ON CONFLICT DO NOTHING` for a first row. If the worker lands before the enqueuer marks the row pending, `markPending` returns `false` and leaves the result alone. A forced re-run still resets the row because it has a fresh correlationId. `KlciEnqueueService` keeps its order (enqueue, then mark): a throwing enqueue therefore never leaves the row pending. Its only change is passing the `Instrument` instead of the id. Not covered: a final *failure* that beats `markPending` would still be overwritten, because `fail` keeps the previous correlationId. That needs retries to finish first, so it is not practical.
- Deleted: `analysis/stock-analysis.store.ts`, `stocks/stock-analysis-read.ts` (series helpers moved to `stocks/series-query.ts`), and the `promoteAnalysisStatus`/`omitArtifactCost` unit tests in `stocks.spec.ts`, which are now covered through the module.
- Tests: the new `analysis/stock-analysis.int-spec.ts` (Postgres + Redis, S3 fake, in-memory bus) covers pending → ready → stale → failed. It checks that a cached pending is gone after land, and that the cached entry still says `ready` while the response says `stale` after a newer bar. It also covers facts_only → stale, the race guard and a forced re-run, the first-row insert, and the 404s (never cached, no S3 call). `stock-analysis.store.spec.ts` was renamed to `stock-analysis.spec.ts` and keeps the bus-landing cases; markPending moved to the int spec. `stocks.int-spec.ts` now wires `StockAnalysis` and announces after its direct row write. `job-bus.int-spec.ts` and `klci-enqueue.spec.ts` were updated for the new constructor and signature.
- Verified: typecheck clean; unit 40/40 suites (416 tests, −4 moved); int 18/18 suites (188 tests).

