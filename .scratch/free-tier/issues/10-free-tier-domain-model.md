# Decide: the free-tier domain model (entities, relations, ratio + taxonomy definitions)

Type: grilling
Status: resolved
Blocked by: 04, 07

## Question

The demo sources ([Decide: demo data posture](04-demo-data-posture.md)) and the ingestion shape ([Decide: ingestion pipeline shape](07-ingestion-pipeline-shape.md)) are fixed. Define the **shared free-tier domain model** the per-feature spec areas all build on. This is the shared entity layer that blocks search/stock-page, screener, announcements, market-overview, and charting specs.

Decide:
- **Entity set and relations:** instrument, price bar, fundamentals snapshot / quarterly financials, derived ratios, indicator snapshot, announcement, corporate action, news article, IPO, Shariah status, watchlist — and how they relate (keys, cardinalities). TypeORM entities live in `apps/backend` (ADR-0004), shared by the API and the ingestion worker (ticket 07 d-process).
- **Provenance marker:** the per-record `source` marker (synthetic vs. aggregator-snapshot vs. real) that enforces the licence boundary (decision B) and drives the visible "illustrative" labelling. Where it lives (per-row column vs. per-table) and how consumers read it.
- **Synthetic co-generation constraint (decision A1):** how the model represents price bars + fundamentals produced together from one seeded generator so all price-derived ratios reconcile.
- **Sector taxonomy:** Bursa's own sectors/subsectors (reference data is real/public — leans this way) vs. a vendor global taxonomy.
- **Ratio definitions:** P/E (TTM vs annual; negative-EPS handling), DY, P/NTA, PSR, ROE, D/E, YoY/consecutive growth — the exact formulas the screener + stock page derive in-house (research 03), defined once here so every consumer agrees.
- **Indicator-snapshot shape:** what the nightly TS indicator step (ticket 07) writes (per-symbol latest snapshot vs. series; which indicators; 52-wk hi/lo as SQL window).

## Notes

- Grilling ticket: consult `grilling` + `domain-modeling`. Resolved terms land in `apps/backend/CONTEXT.md`.
- Blocks the per-feature spec areas; likely graduates several of them (search+stock page, screener, announcements, market overview) once the entities are pinned.


## Answer

The shared free-tier domain model. All terms landed in `apps/backend/CONTEXT.md`.

### Entity set and relations

- **`Company`** (issuer) is separate from **`Instrument`** (tradable line). A company
  may issue >1 instrument. Fundamentals, quarterly financials, announcements,
  corporate actions, and Shariah status attach to **Company**; price bars and
  indicator snapshots attach to **Instrument**.
- **`Instrument`** keyed by internal id; `stockCode` (stable Bursa 4-digit code) is
  the unique natural key; `shortName`/`fullName` are mutable attributes.
- **Analysed universe = ordinary shares of Main + ACE Market companies only.**
  Excludes REITs/ETFs/warrants/structured products (different fundamentals/pricing
  shapes; a later `instrumentType` discriminator + variants can add them behind the
  seam without reshaping the core). The **IPO calendar may still list** non-ordinary-
  share IPOs as plain calendar rows.
- **`QuarterlyFinancials`** = source-of-truth timeline (raw reported line items per
  company per fiscal quarter: revenue, net profit, EPS, equity/NTA, intangibles,
  total borrowings; 3-yr backfill from ticket 07). **`FundamentalsSnapshot`** =
  derived per-company latest rollup (TTM figures, latest NTA, shares outstanding),
  recomputed after each quarterly ingest — mirrors the nightly indicator snapshot.
- **`CorporateAction`** (dividend/bonus/split/rights) is the single source for the
  corporate-actions calendar; dividends here feed DY. **No dividend field on
  financials.**
- **`IndicatorSnapshot`** = one current row per instrument, written nightly.
- **`Sector`** reference entity (Bursa taxonomy), Company FKs to it.
- **`ShariahStatus`** history table (company, status, effectiveDate).
- **`Announcement`** (FK Company, category, filedAt), **`NewsArticle`** (headline +
  link + ticker tags), **`IpoListing`** (curated calendar row) — placed as-is.
- **`Watchlist`**: `User → Watchlist → Instrument`; the only account-bound entity.

### Provenance — lineage, not a per-row marker

**No per-row `source` enum.** An **`IngestionRun`** records the adapter and its
**provenance class** (`synthetic` / `aggregator` / `real`); every sourced row carries
an `ingestionRunId` FK. Read-time "illustrative" label = join to the run (correctness
first; denormalise only if a real endpoint feels it). Reference entities
(`Company`/`Instrument`) stay clean — their `real` provenance is just the reference
adapter's run. **Decision B purge** = delete rows whose run belongs to an
aggregator/synthetic adapter — targeted, and the lineage concept survives usefully
into production (no demo-shaped tech debt). This was chosen over a standalone `source`
column specifically to avoid the tech-debt-at-go-live the column would create.

### Synthetic co-generation (decision A1)

A **`SyntheticRun`** (an ingestion run specialised) carries the **seed + generation
params**; every co-generated price bar and fundamentals snapshot FKs to it, so the
coherent reconciled 3-year timeline is one regenerable, purgeable unit. **Shares
outstanding held constant** across the synthetic timeline (keeps A1 reconciliation
trivial; no share-issuance story to model, so corporate actions don't feed share
count).

### Sector taxonomy

**Bursa's own sector/subsector** (real public reference), modelled as the `Sector`
reference entity so the screener filters without string-matching. No vendor global
taxonomy (KLSE-only demo).

### Ratio definitions (in-house, defined once)

- **P/E** = price ÷ TTM EPS (sum of last 4 quarters' EPS). **Null when TTM EPS ≤ 0**;
  company flagged loss-making (derived: `TTM EPS ≤ 0`) so the stock page shows
  "N/A (loss-making)". No negative P/E. Screener `P/E < X` excludes nulls.
- **DY** = trailing-12-month dividend `CorporateAction`s per share ÷ price (TTM basis;
  no frequency assumption).
- **P/NTA** = price ÷ NTA/share; NTA/share = (equity − intangibles) ÷ shares
  outstanding. **Generator emits a small intangibles line** so P/NTA ≠ P/B.
- **ROE** = TTM net profit ÷ **average** equity (opening+closing over the TTM window;
  correctness chosen since the equity timeline is already present).
- **D/E** = total borrowings (interest-bearing debt) ÷ latest equity.
- **PSR** = market cap ÷ TTM revenue; market cap = price × shares outstanding.
- **YoY growth** = a quarter vs. the same quarter one year prior (revenue, net
  profit). **Consecutive growth** = N consecutive quarters of positive YoY.

### Indicator-snapshot shape

**Per-symbol latest snapshot, not a stored series.** Fields: SMA-20/50/200, RSI-14,
MACD, 52-wk high/low, latest close. Chart overlays recompute from price bars on
demand (charting is out of scope; only chart-*data* endpoints are in scope).
**52-wk high/low** = SQL window over the last 252 trading days of price bars, written
onto the snapshot.

### Graduates

Blocks/graduates the per-feature spec areas now that the entities are pinned: search +
stock page, screener, announcements + news + corporate events, market overview,
watchlist + accounts. Charting-data endpoints remain fog (out-of-scope UI aside, the
backend series-endpoint shape is still unspecified).
