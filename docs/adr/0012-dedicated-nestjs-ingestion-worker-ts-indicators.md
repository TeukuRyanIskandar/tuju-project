# ADR-0012: Dedicated NestJS ingestion worker process + in-house TypeScript indicators (override of TA-Lib-in-Python)

- Status: Accepted
- Date: 2026-09-30
- Deciders: Bursa platform free-tier data effort (wayfinder map: Free-Tier Data — spec 01)
- Context ticket: `.scratch/free-tier-data/issues/04-ingestion-worker-and-indicators.md`
- Spec: `.scratch/free-tier-specs/01-data-ingestion-and-domain-model.md`
- Builds on: [ADR-0002](0002-monorepo-pnpm-turborepo-python-own-world.md) (Python is its own world; entities live once in `apps/backend`), [ADR-0004](0004-data-layer-postgres-typeorm-hybrid-ingestion-s3-claimcheck.md) (NestJS sole Postgres writer; the ephemeral Redis-only intraday layer), [ADR-0006](0006-deployment-single-ec2-compose-aws-rds-s3.md) (single-EC2 compose stack), [ADR-0007](0007-job-result-progress-contract-bullmq.md) (JobBus/contract seam — left untouched by ingestion), [ADR-0011](0011-testing-strategy-per-service-testcontainers-contract-goldens.md) (testcontainers at the seams)

## Context

Spec 01 needs all free-tier data ingest to run on a schedule (nightly EOD prices
+ co-generated fundamentals, then indicators; a 5-minute intraday replay; RSS
news; static disclosures), and it needs technical indicators (SMA/RSI/MACD,
52-week hi/lo) computed and stored as one latest per-instrument snapshot.

Two forks had to be settled, both hard-to-reverse-ish and surprising without
context:

1. **Where do the `@nestjs/schedule` crons live?** The API process already exists
   (identity, JobBus producer, HTTP). Registering the schedule module there would
   mean every cron double-fires the day a second API replica is added — a silent
   correctness bug on the sole-writer path (ADR-0004).
2. **What computes the indicators?** Research 03 originally proposed **TA-Lib in
   the Python worker**. But the free-tier demo prices are *synthetic* (spec 01,
   decision A1): indicator precision is meaningless on fabricated data, and routing
   ingest through Python would drag the AI world (ADR-0002) into the ingestion path
   and couple it to the ADR-0007 job contract for no benefit.

Decision inputs from the spec:

- The demo ingestion should be **one language (TypeScript)** end-to-end (user
  story 12); the Python worker is reserved for AI artifacts only.
- Entities must live **once** in `apps/backend` (ADR-0002/0004) — a second
  workspace would duplicate them and risk drift.
- ADR-0004's sole-Postgres-writer rule governs *language/schema ownership*, not
  process count.

## Decision

### 1. A dedicated second NestJS process (the ingestion worker / "d-process")

Ingest runs in a **second NestJS process booted from the same `apps/backend`
image** via a worker entrypoint (`NestFactory.createApplicationContext`, headless
— no HTTP server): `src/worker-main.ts` → `WorkerModule` → `IngestionModule`. It
shares the **same TypeORM entities, migrations, and DB connection** as the API.
It is **not** a separate workspace (that would duplicate entities and invite
drift vs ADR-0002).

- **`@nestjs/schedule` crons live ONLY in the worker.** `ScheduleModule.forRoot()`
  and `IngestionScheduler` are registered in `IngestionModule`, which the API
  `AppModule` does **not** import. The API process therefore registers zero
  schedule jobs and nothing double-fires. This cron-isolation guarantee is pinned
  by a test (`cron-isolation.spec.ts`) that inspects the module metadata.
- **ADR-0004 sole-writer holds:** both NestJS processes are the same writer (same
  language, same schema, same migrations). Process count is orthogonal to the
  sole-writer rule.
- **Provenance is opened per ingest as `IngestionRun`/`SyntheticRun` lineage**
  (spec 01); every sourced row FKs its run, so the decision-B purge is a targeted
  delete and the read-time "illustrative" label is a single join.
- **Intraday replay touches Redis only, never Postgres** (ADR-0004's
  ephemeral-intraday posture): the replay path holds no repository and opens no
  transaction; ticks are short-TTL Redis keys.
- **Cost accepted:** a second deployable on the single-EC2 box (ADR-0006), fine at
  demo scale. Production intraday-scale recompute graduates to a JobBus system job
  behind the same seam (deferred, not built).

### 2. Indicators computed in-house in TypeScript (`trading-signals`)

SMA-20/50/200, RSI-14 and MACD (12/26/9) are computed in the **NestJS worker in
TypeScript** with the `trading-signals` library over the synthetic close series;
the 52-week high/low is a **SQL window over the last 252 trading days**. One
latest `IndicatorSnapshot` is written per instrument (not a series). The
per-company valuation ratios (P/E, DY, P/NTA, ROE, D/E, PSR, consecutive growth)
are **materialised** onto `FundamentalsSnapshot` from the same reconciled rows,
reusing the single ratio definition module.

This **deliberately overrides research 03's TA-Lib-in-Python**:

- Precision is meaningless on synthetic data, so TA-Lib's numerical fidelity buys
  nothing here.
- It keeps the whole demo ingestion **one language** (user story 12).
- **Python stays out of the free-tier ingestion path**, and **ADR-0007 is
  untouched** by ingestion (no job contract, no queue hop for a nightly batch).
- The **same in-house derivation is retained in paid tiers** — recomputed over
  real licensed prices behind the EODHD adapter swap (ADR-0004). Vendor technical
  endpoints are not the screener engine. An optional TA-Lib engine swap remains a
  deferred option behind the same seam if real-price precision ever demands it.

### 3. Library choice — `trading-signals` pinned to a CJS-dual build

`trading-signals` is pinned to **v7.4.3**, whose package `exports` ship a
CommonJS `require` entry (`dist/index.cjs`) alongside ESM. The backend compiles
to CommonJS (tsconfig `module: CommonJS`, `moduleResolution: Node`); the current
ESM-only v8 line cannot be `require`d and is not consumable without reworking the
whole backend's module system. A small ambient declaration
(`src/types/trading-signals.d.ts`) exposes the used surface so node10 resolution
(which ignores conditional `exports` types) type-checks — without changing the
shared tsconfig that governs the committed build.

## Consequences

**Positive**

- **No double-firing:** crons are structurally confined to the worker; the API
  cannot schedule anything, so adding an API replica never duplicates a nightly
  ingest (the sole-writer path stays correct).
- **One-language demo ingestion:** the entire free-tier ingest is TypeScript;
  Python is reserved for AI artifacts, keeping ADR-0002's language boundary and
  ADR-0007's contract seam clean.
- **Entities defined once:** the worker reuses `apps/backend` entities/migrations,
  so there is no schema duplication or drift (ADR-0002).
- **Extractable later:** the intraday-scale recompute can graduate to a JobBus
  system job behind the same source-adapter seam with no consumer change.

**Negative / risks**

- **A second deployable** on the single-EC2 box (ADR-0006): one more process to
  run and observe. Accepted at demo scale.
- **In-house indicators must be maintained** rather than delegated to a vendor
  endpoint — deliberate, since the screener engine must be ours across tiers.
- **`trading-signals` is pinned to an older (v7) line** to keep a CJS entry; a
  future move to ESM (or `moduleResolution: nodenext`) across the backend would
  let us track the current major. Low-cost, reversible.

## Alternatives considered

- **Register the schedule crons in the existing API process:** rejected — they
  would double-fire the moment a second API replica exists, silently corrupting
  the sole-writer nightly ingest.
- **A separate workspace/package for the worker:** rejected — it would duplicate
  the TypeORM entities/migrations and reintroduce the ADR-0002 drift risk; the
  headless `createApplicationContext` entrypoint from the same image gets a second
  process with zero duplication.
- **TA-Lib in the Python worker (research 03):** rejected for the free tier —
  meaningless precision on synthetic data, drags Python + the ADR-0007 contract
  into the ingestion path for no benefit. Retained only as a deferred, behind-seam
  option for real-price tiers.
- **A standalone cron runner (system crontab / a third service):** rejected — it
  could not share the NestJS DI, entities, and the source-adapter seam, so it
  would re-implement wiring the worker gets for free.
- **`trading-signals` v8 (ESM-only):** rejected for now — not `require`-able under
  the backend's CommonJS build without a module-system overhaul; revisit alongside
  a repo-wide ESM move.
