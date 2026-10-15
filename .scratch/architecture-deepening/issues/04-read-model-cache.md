# ReadModelCache owns keys + invalidation

Status: resolved
Strength: Worth exploring
Dependency category: local-substitutable (Redis testcontainer)
Blocked by: 01

## Files
- `cache/cache-keys.ts`, `cache/read-cache.service.ts`
- Keys built by hand in `stocks/stocks.service.ts:113–175`, `disclosures/disclosures.service.ts:106–152,440`, `market/market.service.ts:70–81`, `search/search.service.ts:72`, `screener/screener.service.ts:58`, `screener/fields.ts:31`, `brief/market-brief.store.ts:17`, `ipo/prospectus-analysis.store.ts:15–22`
- Invalidation call sites: `ingestion/eod-ingest.service.ts:136,352`, `ingestion/purge.service.ts:73`

## Problem
About 20 key templates sit in 8 files. Writers decide for themselves what to invalidate, and the async result writers miss their own keys:
- An announcement summary stays invisible for up to 24h.
- A TA/FA result shows "pending" for up to 1h.

## Direction
One module where readers name a domain read and writers announce a domain change event. Inside the module, an event → prefixes table decides what to clear. The families from 01 call `onDataChanged` from `land()`.

## Tests
"After event X, read Y misses", written once against Redis. Per-service key-string specs are deleted.

## Comments

**2026-10-12, implemented (uncommitted on `refactor/architecture-deepening`).**

- Module (`src/cache/`): `ReadModelCache` replaces `ReadCacheService` (deleted). Interface is three methods: `read(read, loader)` (read-through, class-2 TTL from `APP_CONFIG`, a throw/404 or `undefined` is never cached), `peek(read)` (market's last-known indices), `changed(change)`. `get`/`set`/`del`/`invalidatePrefix`/`invalidateReadCaches` are gone from the interface; SCAN-then-DEL stays private.
- `read-model-reads.ts`: `ReadModelReads`, the only place keys are built (search, stock core/announcements/corporate-actions/analysis, market feed, dealings, both calendars, news, screen, screener fields, EOD movers, indices, index series, latest brief, prospectus at-a-glance/artifact). The services, `screener/fields.ts`, brief and ipo no longer hold key strings or key helpers.
- `read-model-changes.ts`: `ReadModelChange` union and the exhaustive event → prefixes table (`invalidationPrefixesFor`):
  - `eodIngested`, `purged` → search, stocks, disclosures, screener, market. Brief and prospectus are left out on purpose, which replaces the old "deliberately NOT in READ_CACHE_PREFIXES" comments.
  - `announcementSummarised{announcementId, stockCodes}` → `disclosures:announcements:`, `disclosures:dealings:`, `stocks:{code}:announcements:` for each code.
  - `stockAnalysisChanged{stockCode, analysis}` → `stocks:{code}:analysis:{technical|fundamental}`.
  - `marketBriefLanded` → `brief:`. `prospectusAnalysed{id}` → `prospectus:{id}:`.
- Writers: `EodIngestService` (both sweeps) → `eodIngested`; `PurgeService` → `purged`; `MarketBriefStore`/`ProspectusAnalysisStore` land → their events; `AnnouncementSummaryStore.land` → `announcementSummarised`, with the company's stock codes from one join query (fixes the summary being hidden for up to 24h); `StockAnalysisStore.land`/`fail` → `stockAnalysisChanged` (`AnalysisModule` now imports `CacheModule`).
- Keys are byte-compatible with the old ones (pinned in `read-model-reads.spec.ts`), so nothing is orphaned or mis-hit on deploy. Class-3 `intraday:*` keys are untouched.
- Deviation: TA/FA reads stay uncached. Their envelopes promote `stale` at read time, so caching them would cache that status. `markPending` does not announce yet. Ticket 08 must announce from `markPending` (or move it) if it re-caches.
- Tests:
  - New `cache/read-model-cache.int-spec.ts` (real Redis): for each change, exactly the expected reads miss; intraday/session keys survive; SCAN paging over 350 keys.
  - New unit specs: `read-model-changes.spec.ts` (the table), `read-model-cache.spec.ts` (read/peek/changed mechanics, replaces `read-cache.spec.ts`), `read-model-reads.spec.ts` (key goldens plus the screener normalisation cases moved from the deleted `screener/screener-cache-key.spec.ts`; the fields-key pin in `screener-fields.spec.ts` is dropped because it is covered there).
  - `disclosures.int-spec.ts` now checks that a landing summary makes the cached feed, the dealings view and that stock's announcements list miss, while another stock's list stays. `stock-analysis.store.spec.ts` checks the announcements. Int specs that swept prefixes by hand now call `changed({ kind: 'eodIngested' })`.

- Verified: typecheck clean; unit 40/40 suites (420 tests); int 17/17 suites (182 tests).
