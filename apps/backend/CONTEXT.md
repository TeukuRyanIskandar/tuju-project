# Context: Backend (`@tuju/backend`)

NestJS 11 service. Three roles (ADR-0001/0003/0004/0005/0006/0010):

- **Identity authority** — owns users, sessions, and an httpOnly session cookie.
- **Sole Postgres writer** — the only context that writes the relational store
  (TypeORM). The AI worker never writes Postgres (ADR-0004).
- **Job producer** — enqueues `JobEnvelope`s onto the Redis + BullMQ `analysis`
  queue (ADR-0001) and reads results back.

## Responsibility

- Authenticate requests and mint/verify the session cookie (`src/auth`).
- Enforce **tier → capability** at the enqueue seam (`tier.guard`, `tier-policy`,
  `requires-job.decorator`). Tier is re-checked here regardless of what the FE shows.
- Produce jobs and surface results (`src/jobbus`, `src/analysis`), with Bull-Board
  for queue inspection.
- Own the data layer: entities, migrations, `data-source.ts` (`src/data`).
- Expose `/health` (ADR-0010) and structured JSON logging with `correlationId`.

## Boundaries

- Talks to the AI world **only** through the JobBus + `@tuju/contracts` — never
  imports Python code (ADR-0002).
- Consumes `@tuju/contracts` TS types via `workspace:*`; does not redefine message shapes.

## Glossary

- **Company** — the listed issuer. Owns fundamentals, quarterly financials,
  announcements, and Shariah status. Distinct from the tradable line (Instrument);
  a company may issue more than one instrument.
- **Instrument** — a tradable listed line (ordinary share) that price bars and
  indicators attach to. Keyed by an internal id; `stockCode` (the stable Bursa
  4-digit code) is its unique natural key, `shortName`/`fullName` are mutable.
- **Analysed universe** — the set of instruments the free tier prices, values, and
  screens: **ordinary shares of Main + ACE Market companies only**. Excludes REITs,
  ETFs, warrants and structured products (their fundamentals/pricing shapes differ).
  The IPO calendar may still *list* non-ordinary-share IPOs as plain calendar rows.
- **Tier** — the subscription level read from the session; drives capability checks.
- **Capability** — a permission question (e.g. `canRunJob`) derived from tier;
  code asks capabilities, not tier names.
- **Enqueue seam** — the guarded boundary where a request becomes a JobBus job.
- **Free tier** — the dashboard experience available without paying: market data,
  disclosures and discovery tools. Enqueues no user-triggered analysis jobs.
- **Indicator snapshot** — one current row per instrument written nightly by the
  TS indicator step (SMA-20/50/200, RSI-14, MACD, 52-wk high/low, latest close).
  Latest values only, **not** a stored indicator series; chart overlays recompute
  from price bars on demand. 52-wk high/low is a SQL window over the last 252
  trading days, written onto the snapshot.
- **Shariah status** — a per-Company compliance record (compliant / non-compliant)
  with an effective date, kept as a small history table (SC's twice-yearly list),
  not a mutable flag — so the stock page shows the current value with provenance.
- **Watchlist** — the one account-bound entity: `User → Watchlist → Instrument`.
  Limits deferred to the watchlist spec area.
- **IPO listing** — a curated calendar row (manual entry). May be a
  non-ordinary-share IPO (REIT/ETF) even though such instruments are outside the
  analysed universe.
- **Prospectus analysis** — the thin Postgres row (`prospectus_analyses`, unique
  per `IpoListing`) written when an `analyze-prospectus` result lands: verdict-less
  headline + asOf + the S3 claim-check pointer to the rich five-section artifact.
  Row-exists means analysed (the not-yet-processed predicate for `enqueue-prospectus`).
  Served anonymously at `GET /ipo/:prospectusId/at-a-glance` (+ `/artifact` proxy);
  the worker reads its IPO input from `GET /ipo/:prospectusId/reference`.
- **Announcement** — an official disclosure a listed company files with Bursa
  (results, entitlements, dealings, etc.). Distinct from a news article.
- **Announcement category** — a stable internal classification of an Announcement
  (`FINANCIAL_RESULTS`, `ENTITLEMENT`, `SHAREHOLDING_CHANGE`, `GENERAL`,
  `ADDITIONAL_LISTING`, `MEETING`, `CIRCULAR`, `ANNUAL_REPORT`, `LISTING`, `OTHER`).
  The source adapter maps its own labels onto this enum, so a demo aggregator snapshot
  and a later licensed Bursa feed both land on the same categories with no consumer
  change. `SHAREHOLDING_CHANGE` is the substantial-shareholder/director-dealings feed;
  `FINANCIAL_RESULTS` feeds the (backward-looking, when-filed) results calendar.
- **Dealings feed** — the substantial-shareholder/director-dealings surface: a
  *filtered view* of `Announcement` rows where `category = SHAREHOLDING_CHANGE`
  (not a new entity). Exposes only reliably-present list-level fields
  (company, filedAt, title, sourceUrl, provenance); structured
  buyer/seller/volume/price fields wait for the licensed Bursa structured form.
- **Corporate-actions calendar** — a derived read (no entity) over `CorporateAction`
  keyed on `exDate` (the primary axis): dividends, bonuses, splits, rights.
  Default window = next 30 days + 7 back; dividends here are the same rows DY
  reads (single source).
- **Results calendar** — a derived backward-looking read over
  `QuarterlyFinancials` answering *when results were filed*: `reportedAt` is the
  filedAt of the company's own earliest `FINANCIAL_RESULTS` announcement at/after
  the quarter's `periodEnd` (a read-time link, not an FK). Quarters with no
  filed announcement are not on it. Forward earnings-date estimation needs a
  licensed source and is out of scope.
- **News article** — third-party media coverage about a company or the market.
  Not an official disclosure. Stored as headline + link + source + publish time only
  (no body). Tagged to companies in-house by a conservative whole-word alias match
  (see News article tag); an article matching no company is market-level news.
- **News article tag** — the many-to-many link between a NewsArticle and a Company,
  produced by matching the headline against the company's alias set (`shortName`,
  `fullName`, and a curated alias list). Deterministic (not an AI job); one article may
  tag several companies. Ambiguous multi-company hits are all tagged; short or fuzzy
  matches are rejected to avoid false tags.
- **Quarterly financials** — the source-of-truth timeline of raw reported line items
  per company per fiscal quarter (revenue, net profit, EPS, equity/NTA, total debt).
  YoY and consecutive-growth ratios are computed across these rows; ticket 07
  backfills three years. Dividends are **not** here — they are corporate actions.
- **Fundamentals snapshot** — a derived per-company latest rollup the stock page and
  screener read cheaply: TTM figures, latest NTA, shares outstanding (held constant
  across the synthetic timeline). Recomputed after each quarterly ingest, mirroring
  the nightly indicator snapshot.
- **Corporate action** — an announced entitlement or capital event (dividend, bonus,
  split, rights). The single source for the corporate-actions calendar; trailing-12-
  month dividend actions feed the dividend-yield ratio.
- **Screener** — the anonymous free-tier filter surface over the analysed
  universe: one pure-SQL read model (`Instrument ⋈ Company ⋈ Sector ⋈
  FundamentalsSnapshot ⋈ IndicatorSnapshot ⋈ latest ShariahStatus ⋈ latest
  two PriceBars`) behind the `ScreenerQuery` seam. Ratios are read from
  materialised columns, never computed at query time — except
  `yoyProfitGrowth` and `profitableYears`, which the spec-01 materialiser
  does not write and the screener aggregates at query time from
  `QuarterlyFinancials` (lateral joins, no window functions; the resolution
  of the spec-03 gap). NULL ratios never satisfy a band (a loss-maker is
  absent from any P/E screen) and sort last; `%change`/`volume` are read-time
  from the two latest EOD bars (the stock-page precedent). Rows carry
  per-numeric-class provenance (price / fundamentals / technicals lineage).
- **Movers board** — a precomputed market-overview read panel: the day's top
  gainers, losers, and most-active instruments of the whole analysed universe
  (gainers/losers by %change, actives by cumulative intraday volume — no
  liquidity/market-cap floor, spec-05 option A). During market hours the 5-min
  intraday replay precomputes the three boards into Redis as class-3 keys
  (`intraday:movers:*`) so the read endpoint is a pure slice of a sorted board;
  outside hours the read falls back to the latest stored EOD closes (class 2).
- **Sector** — Bursa's own sector/subsector classification (real public reference
  data), modelled as a reference entity the Company FKs to. No vendor global
  taxonomy (demo is KLSE-only).
- **Derived ratios** — valuation/quality figures computed in-house (never vendor-
  supplied), defined once so screener and stock page agree:
  - **P/E** = price ÷ TTM EPS; **null when TTM EPS ≤ 0** (company flagged
    loss-making; no negative P/E). Screener `P/E < X` excludes nulls.
  - **DY** = trailing-12-month dividend corporate actions per share ÷ price.
  - **P/NTA** = price ÷ NTA/share, NTA/share = (equity − intangibles) ÷ shares
    outstanding (generator emits a small intangibles line so P/NTA ≠ P/B).
  - **ROE** = TTM net profit ÷ **average** equity (opening+closing over TTM window).
  - **D/E** = total borrowings (interest-bearing debt) ÷ latest equity.
  - **PSR** = market cap ÷ TTM revenue; market cap = price × shares outstanding.
  - **YoY growth** = a quarter vs. the same quarter one year prior (revenue, net
    profit). **Consecutive growth** = N consecutive quarters of positive YoY.
- **Market index** — a reference entity (`MarketIndex`) naming an index the market
  overview surfaces: a FBM KLCI analogue plus one per Bursa `Sector`. Cap-weighted
  over its constituent instruments. Distinct from an individual instrument's price.
- **Index level** — one cap-weighted level for a market index on a given day
  (`IndexLevel`), a daily time series parallel to price bars (so an index is
  chartable), plus a live intraday level held in Redis during market hours. Carries
  `IngestionRun` provenance like every other sourced row; computed in the demo,
  ingested from a licensed feed or recomputed over real prices in production.
- **Index adapter** — the source-adapter-seam method that serves index levels. The
  demo `SyntheticIndexAdapter` cap-weights the synthetic constituent bars; a
  production `LicensedIndexAdapter` ingests an official published level, or an
  in-house variant recomputes cap-weighted over real licensed prices as a branded
  house index. Consumers (the market-overview endpoints) read `IndexLevel`
  regardless of which adapter produced it.
- **Source adapter** — the seam behind which each data class (market data,
  fundamentals, disclosures, news, Shariah list, IPOs) is served, so a demo source
  swaps for a licensed production source with no change to consumers.
- **Ingestion run** — a single write of sourced data by one adapter. Records the
  adapter and its **provenance class** (`synthetic` / `aggregator` / `real`). Every
  sourced row carries an `ingestionRunId`; provenance is read via that lineage, not
  a per-row marker. The read-time "illustrative" label is a join to the run.
- **Synthetic run** — an ingestion run that co-generates price bars and fundamentals
  from one seed (decision A1). Carries the seed + generation params; every bar and
  fundamentals snapshot it produces FKs to it, so a coherent reconciled timeline is a
  single regenerable, purgeable unit.
- **Synthetic data** — illustrative price/fundamental figures generated for the
  private demo (no vendor licence permits showing real KLSE prices to outside
  partners). Prices and fundamentals are **co-generated** from one seeded generator
  so every price-derived ratio (P/E, market cap, DY, P/NTA) reconciles; always
  surfaced with an "illustrative data" label.
- **Licence boundary** — the line that must be crossed before free-tier data goes
  public: synthetic data may stay (relabelled or swapped to a licensed adapter), but
  unlicensed aggregator-sourced announcements/corporate events must be purged and
  re-sourced from a licensed Bursa feed first.

## Commands

```bash
pnpm --filter backend start:dev   # watch mode
pnpm --filter backend test        # jest (unit)
pnpm --filter backend test:int    # jest integration (testcontainers)
pnpm --filter backend typecheck   # tsc --noEmit
pnpm --filter backend migration:run
```

Ops commands (one-shot, run via the ingestion worker entrypoint —
`node dist/worker-main.js <command>`; manual actions, never crons):

```bash
seed-prospectus [corpusDir]          # upload curated prospectus PDFs to S3 + upsert IpoListing rows (spec 06 t04)
enqueue-prospectus [ipoListingId]    # enqueue analyze-prospectus (trigger 'system') for every IpoListing with a
                                     # prospectusS3Key and no prospectus_analyses row yet; idempotent on re-run.
                                     # Pass an id (or `--force <id>`) to re-run one already-analysed listing (spec 06 t05)
```

## Decisions

System-wide ADRs in `docs/adr/` govern this context (esp. ADR-0001, 0003, 0004,
0005, 0006, 0010). No context-scoped ADRs yet.
