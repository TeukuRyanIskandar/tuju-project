# Decide: ingestion pipeline shape (where ingest, scrapers and indicator computation run)

Type: grilling
Status: resolved
Blocked by: 04

## Question

Given the chosen demo sources ([Decide: demo data posture](04-demo-data-posture.md)) and ADR-0004 (NestJS sole Postgres writer, Python stateless), **where does each ingest step run and how does data land?**

Decide:
- **Scheduler home:** NestJS cron vs. a system-triggered JobBus job per source vs. a mix. Research recommends indicators as a **system-triggered Python job using TA-Lib** ([screener research](03-screener-and-indicator-data.md)), which would be a **new ADR-0007 job type**.
- **Source-adapter seam:** one interface per data class (market data, disclosures, news, Shariah list, IPOs) with demo adapters (synthetic / snapshot / RSS / manual) and production adapters (EODHD / licensed Bursa feed) behind it.
- **Cadences** per data class (EOD nightly, delayed intraday during 09:00–16:45 MYT, disclosures polling, Shariah twice yearly, IPO manual).
- **Backfill depth** for the demo (e.g. years of EOD, quarters of financials needed for growth filters: at least 8).
- Whether the demo's basic screener can skip the indicator job entirely (SQL-only SMA/52-wk hi-lo).


## Answer

**Ingestion runs in a dedicated second NestJS process off the same `apps/backend` codebase (same TypeORM entities/migrations), driven by `@nestjs/schedule` crons. Python is NOT in the free-tier ingestion path at all.** The synthetic generator, RSS pull, snapshot load, Shariah/IPO manual ingest, AND the technical indicators are all TypeScript in this worker. Everything lands behind the ticket-04 source-adapter seam; the Python worker stays reserved for the deferred prospectus analysis (ticket 09).

### Decision 1 — scheduler home: a dedicated NestJS worker process (d-process)

- A **second NestJS process** run from the same `apps/backend` image with a worker entrypoint (e.g. standalone `NestFactory.createApplicationContext`), **not** a separate workspace. Same TypeORM entities, same DB connection, same migrations — so ADR-0004's sole-Postgres-writer rule holds trivially (it is about *language/schema ownership*, not process count; a separate workspace was rejected because it would duplicate entities or need a new shared-entities package — drift risk against ADR-0002).
- **Why a separate process:** isolates batch/ingestion load and failure from the request-serving API process; independently schedulable/sizable; the honest shape of a cron workload. Cost accepted: a second deployable on the single-EC2 box (ADR-0006) — fine at demo scale.
- **Single scheduler owner:** `@nestjs/schedule` crons live **only in the worker process**; the API process does NOT load the schedule module, so nothing double-fires.

### Decision 2 — indicators are computed in the NestJS worker in TypeScript (overrides research 03)

- Demo technical indicators (RSI, SMA-50/200, 52-wk hi/lo, stochastic — research 03's extension set) are computed by a **TS library (`trading-signals`)** over the synthetic price series and persisted to Postgres as indicator snapshots/series. **52-wk hi/lo is a SQL window, not a library call.**
- **This overrides research 03's TA-Lib-in-Python recommendation, deliberately.** Justification: the demo's prices are *synthetic*, so indicator numerical precision is meaningless (the "truth" is whatever the generator produced); TA-Lib's edge is exactness against *real* data. Keeping indicators in TS means the **entire free-tier ingestion path is one language** and the Python worker never enters ingestion — no new `analysis`-queue job type, no new `trigger` enum value, **ADR-0007 untouched by this ticket**. `pandas-ta` being dead upstream (research 03) is now moot.
- **Vendor technical endpoints rejected as the screener engine** (confirms research 03): per-symbol/per-indicator calls don't scale to a whole-universe screen, inherit the vendor's patchy KLSE coverage, and cause definition drift vs. our charts. Indicators stay an **in-house derivation we own** in the demo AND in paid tiers.

### Decision 3 — source-adapter seam (confirms ticket 04's six adapters)

One interface per data class; consumers (screener, stock page, movers board, charts) read from Postgres/Redis and never know the producer:

- `MarketDataAdapter` — demo `SyntheticMarketDataAdapter` / prod `EodhdMarketDataAdapter`
- `FundamentalsAdapter` — demo synthetic (co-generated with prices, decision A1) / prod EODHD
- `DisclosureAdapter` — demo aggregator-snapshot / prod licensed Bursa feed
- `NewsAdapter` — RSS-shaped both
- `ShariahListAdapter` — SC-PDF-sourced both
- `IpoAdapter` — manual both

### Decision 4 — cadences (all crons in the ingestion worker)

| Data class | Cadence | Lands in |
| --- | --- | --- |
| Synthetic EOD prices + co-generated fundamentals | nightly, once (post nominal close) | Postgres |
| Indicator snapshots | nightly, **ordered after** EOD generation (needs fresh bars) | Postgres |
| Synthetic delayed-intraday replay | **every 5 min**, 09:00–16:45 MYT | **Redis aggregated-views class only, never Postgres** (matches ADR-0004 ephemeral-intraday posture) |
| RSS news (headline+link) | every ~15–30 min | Postgres |
| Disclosure / corporate-events | **static one-time captured snapshot** + manual refresh command — **no live re-scrape** of the unlicensed aggregator | Postgres |
| Shariah list | manual, twice-yearly (triggered command, no cron) | Postgres |
| IPO calendar + prospectus PDFs | manual entry (no cron) | Postgres + S3 |

### Decision 5 — backfill depth: 3 years, one coherent timeline

- **EOD prices:** **3 years** (~750 trading days) per ticker — fully warms SMA-200, gives a credible multi-year chart + 1Y/3Y range toggle. Synthetic, so generation cost is nil.
- **Fundamentals:** **12 quarters (3 years)** of co-generated quarterly financials — satisfies research 03's YoY profit growth (needs ≥8 quarters) and gives consecutive-growth signal, all reconciled with prices across the same 3-year window (decision A1).
- The demo **does not** skip an indicator step, but there is **no separate indicator *job*** — it's an ordered cron step in the same worker.

### Recorded deferral (production scaling path, NOT built for the demo)

Every scaling axis is a swap *behind the ingestion seam*, so the demo choice commits to nothing:

- **Intraday-scale recompute:** graduates from a cron loop to a **JobBus system job** (new ADR-0007 job name, additively; new `trigger` value like `'system-ingest'`) with **horizontal worker fan-out** (`--scale`, chunk the universe) when real intraday lands. `trading-signals` is streaming-first, so incremental updates are the same library, not a rewrite.
- **Engine precision:** TA-Lib (Python worker) is the **optional production engine swap** behind the same seam if real-data precision/breadth ever demands it.
- **Indicators in paid tiers:** same in-house derivation, now over **real licensed prices** (the EODHD adapter swap) — you license the *price feed*, indicators stay a free local derivation. Vendor technical endpoints never become the screener engine.
- **Storage:** ADR-0004 already notes Timescale/TSDB as the Product-C graduation path for indicator series; not decided here.

### Hands forward

- Python worker is **out of the free-tier ingestion path** → ADR-0007 unchanged; the only Python job that lands in this map is the deferred prospectus analysis (ticket 09).
- Feeds the **free-tier domain model** fog: adds the ingestion-worker/adapter shape and the indicator-snapshot entity; the "indicators-as-job vs SQL" open question from research 03 is now closed (TS cron step, snapshots in Postgres).
- **Candidate ADR:** the dedicated NestJS ingestion worker + the deliberate TS-indicators-override-of-TA-Lib is hard-to-reverse-ish, surprising-without-context, and a real trade-off — flagged for an ADR when the specs are written (`to-spec`), not created now (planning-only map).
