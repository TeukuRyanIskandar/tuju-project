# Spec: Free-tier data ingestion + domain model (shared foundation)

Status: ready-for-agent

> Handoff spec produced by `to-spec` from the free-tier wayfinder map. Source
> decisions: [demo data posture](../free-tier/issues/04-demo-data-posture.md),
> [ingestion pipeline shape](../free-tier/issues/07-ingestion-pipeline-shape.md),
> [free-tier domain model](../free-tier/issues/10-free-tier-domain-model.md).
> Fixed inputs (do not re-decide): ADR-0001–0011, esp. ADR-0002/0004/0005/0007.
> **This spec blocks all the other free-tier specs** — it owns the entities,
> the ingestion worker, and the source-adapter seam every other spec reads.

## Problem Statement

We are building a **private demo prototype** of the Product A free tier for partners
and early investors. It needs to look and behave like a real Bursa Malaysia
intelligence dashboard — search, stock pages, a screener, disclosures, a market
overview — but **no self-serve data vendor licence permits showing real KLSE prices
to outside parties** (research 01/02). We also have no relational data layer for any
of this yet; the repo has the JobBus/auth/contract skeleton only.

We need a shared data foundation that (a) fills the dashboard with credible,
reconciled data without a price licence, (b) keeps the licence boundary explicit so
nothing unlicensed can leak to a public launch, and (c) presents every consumer
(the other five specs) a clean read model that doesn't know or care where the data
came from.

## Solution

A **source-adapter seam** with demo adapters (synthetic prices/fundamentals, an
aggregator disclosure snapshot, RSS news, manual Shariah/IPO) that a later licensed
production adapter swaps behind with no consumer change. A **dedicated NestJS
ingestion worker process** (same `apps/backend` codebase and TypeORM entities) runs
all ingest on `@nestjs/schedule` crons. All prices and fundamentals are **synthetic,
co-generated from one seed** so every derived ratio reconciles, and always surfaced
with an "illustrative data" label. Provenance is tracked as **ingestion-run lineage**,
not a per-row column, so the licence-boundary purge is a targeted delete and the
concept survives usefully into production. The relational model splits the listed
**issuer (Company)** from the tradable **Instrument**, and defines every derived ratio
once so screener and stock page agree.

## User Stories

1. As a partner viewing the demo, I want every price/fundamental figure clearly
   labelled "illustrative", so that I'm never misled into thinking synthetic numbers
   are real market data.
2. As an investor, I want the demo to feel like a complete Bursa dashboard (real
   company names, sectors, Shariah flags, disclosures), so that the analysis/AI
   engine is judged on a realistic surface.
3. As the platform operator, I want all synthetic prices and their fundamentals to
   reconcile (P/E, market cap, DY, P/NTA all agree), so that no ratio looks obviously
   fabricated.
4. As the platform operator, I want a single command to purge every unlicensed
   (aggregator/synthetic) row via lineage, so that I can cross the licence boundary
   to a public launch cleanly.
5. As a downstream feature (screener, stock page, market overview), I want to read a
   stable relational model that hides the data source, so that swapping a demo
   adapter for a licensed feed changes nothing in my code.
6. As the ingestion worker, I want prices, fundamentals, indicators, news,
   disclosures, Shariah status and IPOs to land on their own cadences, so that each
   data class refreshes at the rate its source allows.
7. As the ingestion worker, I want to regenerate the entire synthetic timeline from a
   stored seed, so that a synthetic run is one reproducible, purgeable unit.
8. As a downstream feature, I want indicator values (SMA/RSI/MACD/52-wk hi-lo) read
   from a nightly per-instrument snapshot, so that I never recompute them at query
   time.
9. As a downstream feature, I want the analysed universe scoped to ordinary shares of
   Main + ACE Market companies, so that REIT/ETF/warrant edge cases don't leak into
   valuation and screening.
10. As the platform operator, I want intraday replay to touch Redis only and never
    Postgres, so that the ephemeral-intraday posture (ADR-0004) holds.
11. As a downstream feature, I want a read-time "illustrative" label derivable by a
    single join to the ingestion run, so that provenance labelling is uniform.
12. As the platform operator, I want the demo ingestion to be entirely one language
    (TypeScript), so that the Python worker is reserved for AI artifacts only.
13. As a downstream feature, I want 3 years of reconciled price + quarterly history,
    so that SMA-200 warms and YoY / consecutive-growth signals are computable.

## Implementation Decisions

### Process shape (ticket 07)

- **A dedicated second NestJS process** (the *ingestion worker* / "d-process") booted
  from the same `apps/backend` image via a worker entrypoint
  (`NestFactory.createApplicationContext`), sharing the **same TypeORM entities,
  migrations, and DB connection** as the API process. Not a separate workspace
  (would duplicate entities / risk drift vs ADR-0002).
- **`@nestjs/schedule` crons live only in the worker process.** The API process does
  not load the schedule module, so nothing double-fires.
- ADR-0004's sole-Postgres-writer rule holds: it governs *language/schema ownership*,
  not process count. Both NestJS processes are the same writer.
- Cost accepted: a second deployable on the single-EC2 box (ADR-0006), fine at demo
  scale. Production intraday-scale recompute graduates to a JobBus system job behind
  the same seam (deferred, not built).

### Source-adapter seam (tickets 04, 07)

One interface per data class; consumers read Postgres/Redis and never know the
producer:

| Adapter | Demo implementation | Production implementation (later swap) |
| --- | --- | --- |
| `MarketDataAdapter` | `SyntheticMarketDataAdapter` | `EodhdMarketDataAdapter` |
| `FundamentalsAdapter` | synthetic, co-generated with prices | EODHD |
| `DisclosureAdapter` | aggregator-snapshot (static) | licensed Bursa feed |
| `NewsAdapter` | RSS (headline+link) | RSS / licensed news |
| `ShariahListAdapter` | SC-PDF manual | SC-PDF manual |
| `IpoAdapter` | manual entry | manual / semi-automated |

### Entities (ticket 10)

- **`Company`** (listed issuer) is separate from **`Instrument`** (tradable line); a
  company may issue >1 instrument. Fundamentals, quarterly financials, announcements,
  corporate actions, Shariah status attach to **Company**; price bars and indicator
  snapshots attach to **Instrument**.
- **`Instrument`** keyed by internal id; `stockCode` (Bursa 4-digit) is the unique
  natural key; `shortName`/`fullName` mutable. Carries a curated `aliases` list (feeds
  news tagging, spec 04).
- **Analysed universe = ordinary shares of Main + ACE Market companies only.** A
  future `instrumentType` discriminator can add REIT/ETF/warrant variants behind the
  seam without reshaping the core. The IPO calendar may still *list* non-ordinary IPOs.
- **`QuarterlyFinancials`** — source-of-truth timeline, per company per fiscal quarter:
  revenue, net profit, EPS, equity, NTA, intangibles, total borrowings. 3-year backfill.
- **`FundamentalsSnapshot`** — derived per-company latest rollup (TTM figures, latest
  NTA, shares outstanding), recomputed after each quarterly ingest.
- **`CorporateAction`** — dividend/bonus/split/rights; single source for the
  corporate-actions calendar and the DY ratio. No dividend field on financials.
- **`IndicatorSnapshot`** — one current row per instrument, written nightly:
  SMA-20/50/200, RSI-14, MACD, 52-wk high/low, latest close. **Latest only, not a
  series.** 52-wk hi/lo = SQL window over the last 252 trading days.
- **`Sector`** — Bursa's own sector/subsector reference entity; Company FKs to it.
- **`ShariahStatus`** — per-company history table (status, effectiveDate).
- **`Announcement`**, **`NewsArticle`**, **`IpoListing`** — placed here; behavioural
  detail (categories, tagging, calendars) owned by spec 04.
- **`Watchlist`** — `User → Watchlist → Instrument`; the only account-bound entity.
  Behavioural spec deferred (see Out of Scope).
- **`MarketIndex` / `IndexLevel`** — introduced by the market-overview spec (spec 05);
  listed here for model-cohesion but owned there.

### Provenance — lineage, not a per-row marker (ticket 10)

- **`IngestionRun`** records the adapter and its **provenance class**
  (`synthetic` / `aggregator` / `real`). Every sourced row carries an `ingestionRunId`
  FK. Read-time "illustrative" label = join to the run.
- Reference entities (`Company`/`Instrument`/`Sector`) are `real` (public reference
  adapter's run).
- **Decision-B purge** = delete rows whose run belongs to an aggregator/synthetic
  adapter. Targeted; lineage survives into production (no go-live tech debt). Chosen
  over a standalone `source` column specifically to avoid that debt.

### Synthetic co-generation (decision A1, ticket 10)

- A **`SyntheticRun`** (specialised `IngestionRun`) carries the **seed + generation
  params**. Every co-generated price bar and fundamentals row FKs to it, so the
  reconciled 3-year timeline is one regenerable, purgeable unit.
- **Shares outstanding held constant** across the synthetic timeline (trivial A1
  reconciliation; corporate actions don't feed share count).
- The generator emits a small **intangibles** line so P/NTA ≠ P/B.

### Indicators in TypeScript (ticket 07 — deliberate override of research 03)

- Indicators computed in the **NestJS worker in TypeScript (`trading-signals`)** over
  synthetic prices, persisted to `IndicatorSnapshot`. 52-wk hi/lo is a SQL window.
- **Overrides research 03's TA-Lib-in-Python** deliberately: precision is meaningless
  on synthetic data; keeps the whole demo ingestion one language; **Python stays out
  of the free-tier ingestion path**; **ADR-0007 untouched** by ingestion.
- Same in-house derivation is retained in paid tiers (over real licensed prices, the
  EODHD adapter swap). Vendor technical endpoints are **not** the screener engine.

### Ratio definitions (ticket 10 — defined once, read by screener + stock page)

- **P/E** = price ÷ TTM EPS (sum of last 4 quarters). **Null when TTM EPS ≤ 0**
  (loss-making flag; no negative P/E). Screener `P/E < X` excludes nulls.
- **DY** = trailing-12-month dividend `CorporateAction`s per share ÷ price.
- **P/NTA** = price ÷ NTA/share; NTA/share = (equity − intangibles) ÷ shares.
- **ROE** = TTM net profit ÷ **average** equity (opening+closing over TTM window).
- **D/E** = total borrowings (interest-bearing) ÷ latest equity.
- **PSR** = market cap ÷ TTM revenue; market cap = price × shares outstanding.
- **YoY growth** = a quarter vs the same quarter one year prior (revenue, net profit).
  **Consecutive growth** = N consecutive quarters of positive YoY.
- These are **materialised** onto `FundamentalsSnapshot` by the nightly ingest, so
  consumers read them, never compute at query time.

### Cadences (ticket 07 — all crons in the ingestion worker)

| Data class | Cadence | Lands in |
| --- | --- | --- |
| Synthetic EOD prices + co-generated fundamentals | nightly, post nominal close | Postgres |
| Indicator snapshots | nightly, **ordered after** EOD generation | Postgres |
| Synthetic delayed-intraday replay | **every 5 min**, 09:00–16:45 MYT | **Redis only, never Postgres** |
| RSS news (headline+link) | every ~15–30 min | Postgres |
| Disclosure / corporate-events | **static one-time snapshot** + manual refresh; no live re-scrape | Postgres |
| Shariah list | manual, twice-yearly (command, no cron) | Postgres |
| IPO calendar + prospectus PDFs | manual entry (no cron) | Postgres + S3 |

- **Backfill = 3 years** for both prices (~750 trading days; warms SMA-200) and
  quarterly fundamentals (12 quarters; satisfies YoY + consecutive growth), one
  coherent reconciled timeline.

### Schema / migrations

- All entities are TypeORM in `apps/backend/src/data`; migrations run on boot
  (existing convention). The analysed universe is ~1,000 rows, so straightforward
  indexed tables; add a `pg_trgm` GIN index on instrument name columns (spec 02).

## Testing Decisions

- **Good test = external behaviour, not implementation.** Test that the seam's
  consumers get correct read models regardless of adapter, that provenance labelling
  and the purge are correct, and that co-generated ratios reconcile.
- **Adapter-seam contract tests:** each `*Adapter` interface has a demo implementation;
  test consumers against a fake adapter so a production adapter swap is provably
  transparent.
- **Synthetic co-generation reconciliation test:** given a seed, assert P/E, market
  cap, DY, P/NTA computed from the emitted bars + fundamentals all agree (the A1
  guarantee). Deterministic from the seed.
- **Provenance/purge test:** seed synthetic + aggregator + real runs; assert the purge
  deletes exactly the synthetic/aggregator rows and leaves reference data + lineage.
- **Ratio-definition tests:** table-driven over the edge cases already pinned
  (loss-maker P/E null, DY on TTM dividends, ROE on average equity, YoY same-quarter).
- **Integration** via testcontainers (Postgres + Redis) per ADR-0011: run a nightly
  ingest end-to-end, assert snapshots + indicator rows land and intraday replay hits
  Redis only.
- Prior art: `apps/backend` jobbus/analysis integration tests, contract goldens in
  `packages/contracts`.

## Out of Scope

- **Frontend/UI** including charting (deferred by the user).
- **Real price data / production licensing contracts** (EODHD commercial, Bursa,
  Twelve Data) — owned by the architecture map's vendor-verification task; here it's a
  later adapter swap.
- **Watchlist behavioural spec** (limits, sign-up path, pre-seeded demo accounts) —
  the entity is fixed here, the behaviour is still fog.
- **Charting/OHLC series endpoints** (intervals, ranges, overlays) — still fog;
  indicators are a latest snapshot, not a series.
- **Anonymous read-API rate-limit / abuse posture** — cross-cutting open question
  (per-endpoint cache class is pinned in each spec; the abuse posture is not).
- **Production intraday-scale recompute** (JobBus fan-out) and the **optional TA-Lib
  engine swap** — deferred behind the seam.
- **The `MarketIndex`/`IndexLevel` behaviour** — owned by spec 05.

## Further Notes

- **Candidate ADR (flagged by ticket 07):** the dedicated NestJS ingestion worker +
  the deliberate TS-indicators-override-of-TA-Lib. Hard-to-reverse-ish, surprising
  without context, a real trade-off — **write this ADR (next number after 0011,
  i.e. ADR-0012) as part of executing this spec.**
- All domain terms already landed in `apps/backend/CONTEXT.md`; keep it authoritative.
- Provenance labelling copy ("illustrative data") is a product string, surfaced by
  every consumer spec.
