# Integration specs reach the integration lane

Status: resolved
Track: backend

## Done

- Renamed 9 `*.int.spec.ts` files to `*.int-spec.ts`.
- Added the `apps/backend/src/test-lane-naming.spec.ts` guard, which fails the unit lane if a misnamed file appears.

## Remaining

The baseline `test:int` run of the renamed files gives 5 failed suites and 4 passed (49 failed tests, 81 passed). The specs broke while they weren't running:

- 46 failures: `Nest can't resolve dependencies of the ReadCacheService (REDIS_CLIENT, ?)`. The test modules are missing `APP_CONFIG`, which was added in commit b272afb ("cache TTL from config").
- 3 failures: `EntityMetadataNotFoundError: No metadata for "Instrument"`.

Repair these before any backend ticket, because they are that track's safety net.

## Comments

**2026-10-12, spec repair:**

- **APP_CONFIG (ingestion, disclosures, movers, indices ×3 modules, stocks, klci-ops).** These specs hand-wire `ReadCacheService` but did not provide `APP_CONFIG`. I added a local `fakeConfig()` copied from `market-brief.int-spec.ts` and bound it with `{ provide: APP_CONFIG, useValue: fakeConfig() }`.
- **`No metadata for "Instrument"` (search, 3 tests). This was a production bug.** b272afb changed `DataModule` to `autoLoadEntities` with per-module `forFeature` registration. Search, screener, disclosures, market and ingestion never declare `forFeature`, so their entities were never registered. Neither `AppModule` nor `WorkerModule` could boot: a probe against testcontainers failed with `Entity metadata for Company#sector was not found` and retried until it gave up. Fix: `DataModule` now registers `entities: ENTITIES` (the same array `data-source.ts` uses) and keeps `autoLoadEntities`. After the fix, both root modules booted with all 24 entities registered.
- **stocks.int-spec.ts (not renamed, but failing).** It had the same APP_CONFIG problem. Since 380b890, `StocksService` also injects `@InjectRepository` repositories, so the test now binds each `getRepositoryToken(X)` to `dataSource.getRepository(X)`.
- **stocks "analysis thin: … read-time stale" assertion. This was a production bug.** 380b890 wrapped `getTechnicalAnalysis` and `getFundamentalAnalysis` in a 1-hour read cache that nothing invalidates when `TechnicalAnalysisStore`/`FundamentalAnalysisStore` upsert the JobBus result. A cached `pending` envelope therefore hides ready/failed for up to an hour. The commit message does not mention this cache. Minimal fix: the thin envelope reads are uncached again, as they were before 380b890. The assertion is unchanged.
- **klci-ops.spec.ts → klci-ops.int-spec.ts.** It starts testcontainers but was in the unit lane. I renamed it and fixed its APP_CONFIG. `test-lane-naming.spec.ts` now also fails on any non-int `*.spec.ts` that imports `testcontainers` or `@testcontainers/*`. No other files matched.
- **Results.** `test:int`: 15/16 suites, 169/171 tests. The only failure is `jobbus/job-bus.int-spec.ts` (2 tests, "Custom Id cannot contain :"), the known BullMQ colon-id bug owned by another ticket. Unit lane: 37/37 suites, 372/372 tests. `tsc --noEmit` is clean.
- **Not fixed: `DataModule` migrations.** The list omits `AddSchemaDecorators1728350000000`, which `data-source.ts` includes. Out of scope here.

