# Build ticket: Nightly re-ingest idempotency (runNightly is single-shot only)

Type: task
Status: open
Blocked by: (none)

> Filed on the free-tier-data effort (spec-01 scope) from findings made by the
> **free-tier-search** effort's cache-invalidation integration test
> (`apps/backend/src/ingestion/ingestion.int.spec.ts`, 4th test), which runs
> `EodIngestService.runNightly()` a second time against a populated database.
> Discovered post-completion of tickets 01–04; nothing was changed in the
> ingest code by that effort.

## The finding

**`runNightly()` is not idempotent: a second run against a populated DB fails
the whole ingest.** Every `runNightly()` call opens fresh `IngestionRun` /
`SyntheticRun` lineage rows and INSERTs the adapters' output via
`manager.getRepository(X).save(repo.create({...}))` — a plain INSERT with a new
uuid, never an upsert. The adapters' demo snapshots are static, so a second run
re-inserts the *same* rows.

### Failure chain (in transaction order)

1. **First hard failure:** `persistShariah` violates
   `UQ_shariah_statuses_company_effective` (unique on `company_id` +
   `effective_date`, the history-table key) — observed for real:
   `QueryFailedError: duplicate key value violates unique constraint
   "UQ_shariah_statuses_company_effective"` at
   `eod-ingest.service.ts:375` (`persistShariah`).
2. Fixing that alone **moves the failure, doesn't fix the ingest** — the same
   run then collides at materialisation (later in the same transaction):
   - `fundamentals_snapshots.company_id` — `@Index({ unique: true })`
     (OneToOne, one current snapshot per company);
   - `indicator_snapshots.instrument_id` — `@Index({ unique: true })`
     (one current row per instrument).
3. **Silent-duplication tables** (no unique constraints — would duplicate if a
   transaction ever got past the failures above, and DO duplicate across
   partially overlapping data): `price_bars`, `quarterly_financials`,
   `announcements`, `corporate_actions`, `news_articles`, `ipo_listings`.
   `news_articles.url` is the one non-unique-class table with a unique index —
   a second run of the static RSS snapshot would collide there too.

### Why it matters (impact)

- **The nightly cron itself breaks from night 2 onwards.** The demo
  docker-compose boots the worker with the `nightly-eod-ingest` cron
  (`EVERY_DAY_AT_8PM` Asia/Kuala_Lumpur). Night 1 succeeds; **every subsequent
  night fails** at `persistShariah`, rolls the whole transaction back (no
  corruption — the ingest is one transaction), logs loudly, and refreshes
  nothing. The demo currently only works because each fresh `docker compose up`
  starts from an empty DB.
- The one-shot worker command (`node dist/worker-main.js ingest`) is likewise
  single-shot against a populated DB.
- **No data corruption, no cache staleness:** the failure aborts before commit,
  and ticket-01's class-2 cache invalidation runs only after a successful
  commit — so cached pages stay consistent with the unchanged DB. The defect is
  "no refresh ever lands", not "wrong data".

### Current workaround (test-only)

The cache-invalidation integration test clears the `real` shariah + IPO rows
before its second nightly (the decision-B purge removed the synthetic +
aggregator rows anyway), so the re-run lands cleanly. This is a test shim, not
a fix — and it only works because that test runs the purge first.

## Fix options (decision to make here; both respect A1/ADR-0012)

- **A. Regen-replaces (lineage-scoped):** inside the nightly transaction, delete
  the prior `synthetic`- and `aggregator`-class data rows FIRST (i.e. a
  `PurgeService.purgeWithManager`-style delete for those two classes only),
  then insert fresh. This matches the domain model's intent — a `SyntheticRun`
  is "a single regenerable, purgeable unit" and the demo aggregator snapshot is
  static — so every nightly is a clean regen of the whole demo timeline. The
  `real` manual rows (shariah/IPO) then need upserts on their natural keys
  (shariah already has the unique key; IPO needs a dedupe decision, e.g.
  `(company_name, listing_date)`).
- **B. Idempotent upserts per table:** upsert on natural keys everywhere
  (shariah `(company, effective_date)`, snapshots on their unique
  company/instrument keys, plus new unique indexes + upserts for
  price_bars `(instrument, trade_date)` etc.). More keys added to more tables;
  keeps prior lineage rows accumulating per run (which may actually be desired
  for audit — but every old synthetic run's bars stay, growing the demo DB
  nightly).

Recommendation leaning (not decided): **A** — it is the smallest coherent
semantic ("the demo timeline is the latest regen"), reuses the purge machinery
already written, and keeps the table count of new unique indexes at zero
beyond what exists. Verify against the decision-B purge test expectations
(`purgeUnlicensed` must still work on the post-regen state).

## Out of scope

- Licensed-feed ingest behaviour (aggregator snapshots become non-static then;
  regen-replaces may need rethinking for incremental disclosures — note it in
  the ticket answer, don't solve it).
- The spec-02 read layer (already correct against either option).

## Testing seam (TDD)

Extend `ingestion.int.spec.ts` (or a sibling int spec): run `runNightly()`
TWICE against the same containers, unmodified — assert the second run
completes, and row counts after run 2 equal counts after run 1 (no duplicates,
no missing rows, indicator/fundamentals snapshots still one per
instrument/company). The existing purge test + cron-isolation tests must stay
green. Remove the test-only shariah/IPO clear in the cache-invalidation test
once the second nightly is clean.

## Answer

(open)
