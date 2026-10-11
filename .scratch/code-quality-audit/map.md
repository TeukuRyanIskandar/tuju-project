# Code Quality Audit — Navigation Map

**Date:** 2026-10-11  
**Scope:** Post-Phase A architecture and code quality review  
**Total Issues:** 26 (5 Critical, 9 Major, 12 Minor)

## Quick Summary

| Severity | Count | Status | Effort |
|---|---|---|---|
| **Critical** | 5 | ✅ 4 completed, 1 wontfix | High — require immediate attention; block production |
| **Major** | 9 | ✅ All completed | Medium — correctness/safety concerns; fix before scaling |
| **Minor** | 12 | ✅ All completed (7 batches) | Low — quality of life; 11 pt total effort |
| **wontfix** | 1 | Accepted PoC risk | Auth stub; revisit when paid tiers activate |

**Overall Status:** 26/26 issues resolved (19 agent, 2 ops docs, 5 wontfix)

## Critical Issues — Completed ✅

All 4 actionable critical issues have been fixed:

| # | Title | Fix Applied | Status |
|---|---|---|---|
| 01 | [Fake LLM always returned](issues/01-fake-llm-client-always-returned.md) | Read `OPENROUTER_API_KEY` and `LLM_MODEL` from env; raise `TerminalJobError` on missing config | ✅ completed |
| 02 | [JobFailure corrupted fields](issues/02-jobfailure-corrupted-fields.md) | Async 'failed' listener; fetch job envelope for `correlationId`; detect terminal failures from `failedReason` prefix | ✅ completed |
| 03 | [N+1 indicator materialisation](issues/03-n-plus-one-indicator-materialise.md) | Replaced per-row `findOneOrFail` loop with single batched SQL query | ✅ completed |
| 04 | [No global ValidationPipe](issues/04-no-global-validation-pipe.md) | Added `ValidationPipe` to `main.ts`; created `LoginRequestDto` and `AnalysisRequestDto` | ✅ completed |

**Note:** Issue 05 (auth stub tier bypass) remains `wontfix` (accepted PoC risk).

## Major Issues — All Completed ✅

All 9 major issues are now resolved:

| # | Title | Complexity | Status |
|---|---|---|---|
| 06 | [Entities list duplicated](issues/06-entities-list-duplicated.md) | Low | ✅ completed |
| 07 | [ProgressReporter = Any](issues/07-progress-reporter-any-type.md) | Low | ✅ completed |
| 08 | [Deprecated handle_analysis_job](issues/08-deprecated-handle-analysis-job.md) | Low | ✅ completed |
| 09 | [StocksService direct DataSource](issues/09-stocks-service-direct-datasource.md) | Medium | ✅ completed |
| 10 | [FundamentalPayload period mismatch](issues/10-fundamental-artifact-period-mismatch.md) | Low | ✅ completed |
| 11 | [READ_CACHE_TTL via process.env](issues/11-read-cache-ttl-process-env.md) | Low | ✅ completed |
| 12 | [N+1 persistAnnouncements](issues/12-persist-announcements-n-plus-one.md) | Low | ✅ completed |
| 13 | [/health always OK](issues/13-health-endpoint-always-ok.md) | Low | ✅ completed |
| 14 | [correlationId re-minted](issues/14-jobfailure-correlation-id-re-minted.md) | Low | ✅ completed |

## Minor Issues — All Completed ✅

All 12 minor issues have been fixed and organized into 7 batches for parallel execution:

### Batch A — DB Schema Decorators (1 pt) ✅

| # | Title | Status | Change |
|---|---|---|---|
| 17 | [TechnicalAnalysis missing index](issues/17-technical-analysis-missing-index.md) | ✅ completed | Added `@Index()` on `instrumentId`; updated both TA and FA entities |
| 18 | [Watchlist missing unique](issues/18-watchlist-missing-unique-constraint.md) | ✅ completed | Added `@Unique(['userId'])` constraint to prevent duplicate watchlists |
| 21 | [updatedAt manually managed](issues/21-updated-at-manually-managed.md) | ✅ completed | Replaced manual column with `@UpdateDateColumn` in 3 entities; migration generated |

**Files:** `technical-analysis.entity.ts`, `fundamental-analysis.entity.ts`, `watchlist.entity.ts`, `prospectus-analysis.entity.ts`, migration `AddSchemaDecorators1728350000000`

---

### Batch B — Config Validation (1 pt) ✅

| # | Title | Status | Change |
|---|---|---|---|
| 19 | [COOKIE_SAMESITE cast](issues/19-cookie-samesite-unvalidated-cast.md) | ✅ completed | Added `parseCookieSameSite()` validation; throws on invalid values |
| 24 | [Cron timezone unverified](issues/24-cron-expression-timezone-unverified.md) | ✅ completed | Switched to explicit UTC cron (12:00 UTC = 20:00 MYT for nightly ingest); added TZ env vars |

**Files:** `config.ts`, `ingestion.scheduler.ts`, `docker-compose.yml`

---

### Batch C1 — Job ID Registry (2 pt) ✅

| # | Title | Status | Change |
|---|---|---|---|
| 15 | [Job ID delimiter mismatch](issues/15-job-id-delimiter-mismatch.md) | ✅ completed | Created `job-id-formats.ts` registry; unified to colon delimiter everywhere; centralized parsers |

**Files:** `job-id-formats.ts` (new), `job-bus.service.ts`, `klci-enqueue.service.ts`, `stock-analysis.upsert.ts`, 3 test files updated

---

### Batch C2 — schemaVersion Registry (2 pt) ✅

| # | Title | Status | Change |
|---|---|---|---|
| 22 | [schemaVersion scattered](issues/22-schema-version-strings-scattered.md) | ✅ completed | Created `schema-versions.ts` registry; updated codegen to emit Python equivalents; TS + Python now sync'd |

**Files:** `schema-versions.ts` (new), `artifact.ts`, `generate.mjs` (codegen), 7 Python modules updated, `schema_versions.py` (generated)

---

### Batch E — Performance & Constraints (2 pt) ✅

| # | Title | Status | Change |
|---|---|---|---|
| 20 | [Analysis read 3 queries](issues/20-analysis-read-sequential-queries.md) | ✅ completed | Wrapped `getTechnicalAnalysis` + `getFundamentalAnalysis` in `ReadCacheService` (1h TTL) |
| 26 | [ProspectusRiskData min_length](issues/26-prospectus-risk-min-length-one.md) | ✅ completed | Changed schema from `.min(1)` to `.min(0)`; added warning log for empty risk lists; eliminates LLM retry waste |

**Files:** `stocks.service.ts`, `artifact.ts`, `handler.py`, Python models regenerated

---

### Batch D — DataModule Encapsulation (3 pt) ✅

| # | Title | Status | Change |
|---|---|---|---|
| 16 | [DataModule global entities](issues/16-data-module-global-entity-registration.md) | ✅ completed | Removed global `forFeature(ENTITIES)`; created `watchlist.module.ts` stub; feature modules now self-document their entity ownership |

**Files:** `data.module.ts`, `app.module.ts`, `watchlist.module.ts` (new)

---

### Batch F — Ops Documentation (ready-for-human) ✅

| # | Title | Status | Change |
|---|---|---|---|
| 23 | [Redis no eviction policy](issues/23-redis-no-eviction-policy.md) | ✅ completed | Added Redis config (`--maxmemory 512mb --maxmemory-policy allkeys-lru`); created ops guide with monitoring + recovery |
| 25 | [BullMQ no migration strategy](issues/25-bullmq-payload-no-migration-strategy.md) | ✅ completed | Created deployment runbook; amended ADR-0007; documented queue-safe deployment checklist + incident response |

**Files:** `docker-compose.yml`, `redis.module.ts`, `docs/ops/redis-configuration.md` (new), `docs/ops/queue-deployment-runbook.md` (new), `ADR-0007` amended

## Cross-Cutting Patterns

### Configuration Management (M-6, m-5, m-4)
- **Pattern:** Use `AppConfig` DI at boot, not `process.env` at call-time
- **Files to update:** `config.ts`, `load-config.ts`, `read-cache.service.ts`, `session-store.ts`

### N+1 Queries (C-4, M-7, m-6)
- **Pattern:** Batch queries with `WHERE IN`, JOIN, or read cache
- **Files:** `eod-ingest.service.ts`, `stocks.service.ts`, `ipo.service.ts`

### Type Safety (M-2, m-8, m-9)
- **Pattern:** Avoid `Any`, use strict types, central registries
- **Files:** `ta_fa_analysis.py`, `artifact.ts`, `schema-versions.ts`

### Database Schema (m-3, m-4, m-7)
- **Pattern:** Use TypeORM decorators (`@Index`, `@Unique`, `@UpdateDateColumn`)
- **Files:** `technical-analysis.entity.ts`, `watchlist.entity.ts`, `prospectus-analysis.entity.ts`

## Recommended Priority Order

### ✅ Completed (All Sprints)

All critical and major issues are complete. All 12 minor issues addressed via 7 focused batches:

1. **Batch A** (Decorators): 17, 18, 21 — Database schema hardening
2. **Batch B** (Config): 19, 24 — Environment validation at boot
3. **Batch C1** (Job ID): 15 — Job identifier unification
4. **Batch C2** (Schemas): 22 — Cross-language version registry
5. **Batch E** (Performance): 20, 26 — Read caching + constraint relaxation
6. **Batch D** (Refactor): 16 — Module encapsulation
7. **Batch F** (Ops): 23, 25 — Infrastructure documentation + runbooks

### Deployment Checklist

Before shipping to production:
- [ ] Apply migration `AddSchemaDecorators1728350000000` to dev/staging
- [ ] Verify read cache hit rates on analysis endpoints (should drop query count by 3x)
- [ ] Review Redis eviction policy with ops team (`docs/ops/redis-configuration.md`)
- [ ] Run full integration test suite
- [ ] Update deployment runbook with BullMQ safety checks (`docs/ops/queue-deployment-runbook.md`)
- [ ] Document new modules: `watchlist.module.ts`, `job-id-formats.ts`, `schema-versions.ts`

## Positive Takeaways

Several things are done well:
- Strong layering discipline (controllers → services → stores → repos)
- Sound contract codegen pipeline (Zod → JSON Schema → Pydantic)
- Pre-write artifact validation (catch-at-source pattern)
- Session revocation instant via Redis
- Cron isolation (scheduler only in worker module)
- Test coverage breadth (52 test files)

---
