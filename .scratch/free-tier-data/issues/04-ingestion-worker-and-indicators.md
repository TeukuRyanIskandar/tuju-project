# Build ticket: Ingestion worker process + crons + indicator/ratio materialisation

Type: task
Status: resolved
Blocked by: 02, 03

> Execution effort breaking down
> [spec 01 — data ingestion + domain model](../../free-tier-specs/01-data-ingestion-and-domain-model.md).
> **Wave 2 — the integration join point.** Needs the adapter seam (ticket 02) and the
> synthetic generator (ticket 03) to exist. Fixed inputs: ADR-0001–0011 (esp.
> ADR-0002/0004/0006), the entities in `apps/backend/src/data/entities/`.

## Scope (this ticket only)

The **dedicated NestJS ingestion worker process** and everything that runs on it:
the `@nestjs/schedule` crons, persistence of adapter output onto Postgres via the
`IngestionRun` lineage, **indicator computation in TypeScript** (`trading-signals`),
and **ratio materialisation** onto `FundamentalsSnapshot`. **Write ADR-0012 as part of
this ticket.**

### Process shape (spec 01)

- A **second NestJS process** booted from the same `apps/backend` image via a worker
  entrypoint (`NestFactory.createApplicationContext`), sharing the same entities,
  migrations, and DB connection. **Not** a separate workspace.
- **`@nestjs/schedule` crons live only in the worker.** The API process must not load
  the schedule module (nothing double-fires).
- ADR-0004 sole-writer holds: both NestJS processes are the same writer.

### Cadences (spec 01 table)

| Data class | Cadence | Lands in |
| --- | --- | --- |
| Synthetic EOD prices + co-generated fundamentals | nightly | Postgres |
| Indicator snapshots | nightly, **ordered after** EOD | Postgres |
| Synthetic delayed-intraday replay | every 5 min, 09:00–16:45 MYT | **Redis only** |
| RSS news | ~15–30 min | Postgres |
| Disclosure / corporate-events | static snapshot + manual refresh | Postgres |
| Shariah list | manual (command, no cron) | Postgres |
| IPO calendar + prospectus PDFs | manual entry | Postgres + S3 |

### Indicators + ratios

- Compute SMA-20/50/200, RSI-14, MACD in **TypeScript (`trading-signals`)** over
  synthetic prices; 52-wk hi/lo = SQL window over last 252 trading days; write one
  latest `IndicatorSnapshot` per instrument (not a series).
- **Materialise** the ratios (P/E, DY, P/NTA, ROE, D/E, PSR, consecutive growth) onto
  `FundamentalsSnapshot` after each quarterly ingest, per the definitions in ticket 03.
- Backfill = 3 years, one coherent reconciled timeline.

### Provenance + purge

- Open one `IngestionRun` (or `SyntheticRun`) per ingest; every sourced row FKs it.
- Implement the **decision-B purge** command: delete rows whose run is
  `synthetic`/`aggregator`, leaving `real` reference data + lineage intact.

## ADR-0012 (write here)

Dedicated NestJS ingestion worker + TS-indicators-override-of-TA-Lib. Next number
after 0011. Capture: second process rationale, `@nestjs/schedule`-in-worker-only,
one-language demo ingestion, Python out of the ingestion path, ADR-0007 untouched.

## Out of scope

- Adapter interfaces (ticket 02) and generator logic (ticket 03) — consumed here.
- Read endpoints (specs 02–06).
- Watchlist behaviour, charting/OHLC series, anonymous rate-limit posture — still fog.
- Additive ADR-0007 amendment + prospectus job — spec 06.

## Testing seam (TDD)

- **Integration via testcontainers** (Postgres + Redis, ADR-0011): run a nightly
  ingest end-to-end; assert snapshots + indicator rows land and intraday replay hits
  **Redis only** (never Postgres).
- **Provenance/purge integration test:** seed synthetic + aggregator + real runs;
  assert the purge deletes exactly synthetic/aggregator rows and leaves reference data
  + lineage.
- **Cron-isolation test:** the API process context does not register schedule jobs.
- **Indicator test:** known price series → expected SMA/RSI/MACD/52-wk values.

Prior art: `apps/backend` jobbus/analysis integration tests (testcontainers harness).


## Answer

Implemented the dedicated NestJS ingestion worker, its crons, provenance-lineaged
persistence, TS indicators + ratio materialisation, the Redis-only intraday replay,
the decision-B purge, and ADR-0012. Built on the committed entities (unmodified),
wired the ticket-02 adapter seam, and delegated to the ticket-03 generator.

### Worker entrypoint + process shape

- `apps/backend/src/worker-main.ts` — headless entrypoint via
  `NestFactory.createApplicationContext`. Default `serve` mode registers the crons
  and stays resident; also supports one-shot commands `ingest` / `intraday` /
  `purge` (`node dist/worker-main.js [command]`).
- `apps/backend/src/worker.module.ts` — worker root (ConfigModule +
  ObservabilityModule + RedisModule + IngestionModule); no HTTP/auth.
- `apps/backend/src/ingestion/ingestion.module.ts` — owns
  `ScheduleModule.forRoot()` + `IngestionScheduler`. The API `AppModule` does NOT
  import it → cron isolation. Shares the same entities/migrations/DB connection
  (ADR-0004 sole-writer; both NestJS processes are the same writer).
- Ops wiring: `apps/backend/package.json` `worker`/`worker:prod` scripts; a
  `ingestion-worker` service added to `docker-compose.yml` (same image, worker
  entrypoint, depends_on backend healthy for the boot migration).

### Files added

- `src/ingestion/reference-universe.ts` — curated `real` demo universe + per-instrument seed derivation.
- `src/ingestion/reference-data.service.ts` — idempotent sector/company/instrument seeding (`real` run).
- `src/ingestion/ingestion-run.service.ts` — opens `IngestionRun`/`SyntheticRun` lineage per ingest.
- `src/ingestion/indicators.ts` — pure TS SMA-20/50/200, RSI-14, MACD (12/26/9), 52-wk window via `trading-signals`.
- `src/ingestion/fundamentals-materialiser.ts` — materialises P/E, DY, P/NTA, ROE, D/E, PSR, consecutive-growth (reuses the single ratio module).
- `src/ingestion/eod-ingest.service.ts` — nightly orchestration in one transaction; indicators/ratios ordered strictly after EOD; 52-wk hi/lo via SQL window over last 252 days.
- `src/ingestion/intraday-replay.service.ts` — Redis-only replay (no repository, no transaction; short-TTL keys).
- `src/ingestion/purge.service.ts` — decision-B by-lineage purge (deletes synthetic/aggregator data rows; keeps real + lineage rows).
- `src/ingestion/ingestion.scheduler.ts` — the worker-only `@Cron`s.
- `src/types/trading-signals.d.ts` — ambient decl so node10 resolution consumes the CJS-dual build.

### Files edited (allowed by scope)

- `src/data/adapters/demo-adapters.ts` — wired the ticket-03 generator into `SyntheticMarketDataAdapter`/`SyntheticFundamentalsAdapter`; gave the aggregator/manual adapters small static snapshots so ingest lands aggregator + real rows.
- `apps/backend/package.json` — added `@nestjs/schedule@6.0.1`, `trading-signals@7.4.3` (CJS-dual; v8 is ESM-only and not `require`-able under the CommonJS backend), and `worker`/`worker:prod` scripts.
- `docker-compose.yml` — added the `ingestion-worker` service.

Entities in `src/data/entities/` and the migration were NOT modified.

### Cron list (worker only)

- `nightly-eod-ingest` — `EVERY_DAY_AT_8PM` (Asia/Kuala_Lumpur): EOD prices +
  co-generated fundamentals → Postgres, then (ordered after) ratio + indicator
  snapshots.
- `intraday-replay` — `EVERY_5_MINUTES` (Asia/Kuala_Lumpur), guarded to
  09:00–16:45 MYT: synthetic intraday tick per instrument → **Redis only**.

### ADR

- `docs/adr/0012-dedicated-nestjs-ingestion-worker-ts-indicators.md` — dedicated
  worker process + `@nestjs/schedule`-in-worker-only + one-language TS-indicators
  override of TA-Lib-in-Python (Python out of the ingestion path; ADR-0007
  untouched).

### Tests (all in the default `test` lane per this ticket)

- `src/ingestion/indicators.spec.ts` (4) — known series vs independently-computed `trading-signals`; short-series null-out; 52-wk bounded to last 252; empty throws.
- `src/ingestion/cron-isolation.spec.ts` (3) — API `AppModule` registers neither `ScheduleModule` nor the worker/scheduler; worker composes them; market-hours guard bounds intraday.
- `src/ingestion/ingestion.int.spec.ts` (3, testcontainers Postgres+Redis, ADR-0011):
  1. nightly ingest lands price/fundamentals snapshots + per-instrument indicator rows (SMA-200/RSI/MACD/52-wk warmed; ratios materialised);
  2. intraday replay writes to Redis only — Postgres row counts unchanged;
  3. decision-B purge deletes exactly synthetic/aggregator rows, keeps real reference data + all lineage rows.

### Verification output

- `pnpm --filter @tuju/backend typecheck` → clean (exit 0).
- `pnpm --filter @tuju/backend test` → **Test Suites: 11 passed; Tests: 96 passed**
  (86 pre-existing + 10 new). Docker/testcontainers ran for real.
- `pnpm --filter @tuju/backend test:int` → 2 passed (existing JobBus lane, unaffected).
- `pnpm --filter @tuju/backend build` → clean; `dist/worker-main.js` emitted.
- `docker compose config` → valid.

Left in the working tree (not committed) per instructions.

## Comments

- **Committed** (map sync, post-hoc): the wave-2 work landed in `7b10846`
  ("feat(backend): free-tier ingestion seam, synthetic generator, worker (spec
  01, tickets 02-04)"), followed by `7fc11ab` fixing the two hard violations
  from the post-implementation code review (double-init in the worker serve
  path; ADR-0010 structured-log violation). The "not committed" line above is
  historical.
- **Follow-up filed:** a second `runNightly()` against a populated DB fails the
  whole ingest (re-ingest is not idempotent) — discovered later by the
  spec-02 effort's cache test and filed as
  [ticket 05 — nightly re-ingest idempotency](05-nightly-reingest-idempotency.md).
  The verification above (single nightly + purge in fresh containers) never
  exercised the re-run path, which is why this surfaced late.
