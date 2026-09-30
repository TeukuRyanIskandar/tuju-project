# Spec: screener (free-tier backend)

Type: grilling
Status: resolved
Blocked by: 10

## Question

With the domain model fixed ([Decide: the free-tier domain model](10-free-tier-domain-model.md))
and research 03's filter set + in-house derivation, produce the handoff spec for the
**basic screener** backend.

Decide (inside this spec):
- **Filter set:** the demo filter fields (research 03 baseline: sector, market-cap
  band, P/E, DY, P/NTA, ROE, D/E, Shariah flag, YoY/consecutive-growth) and the
  technical extension (RSI, price vs. SMA) reading the IndicatorSnapshot.
- **Query shape:** filtering our own Postgres over FundamentalsSnapshot + latest
  IndicatorSnapshot + Sector + ShariahStatus; null-ratio handling (P/E null excluded
  from `< X`).
- **Result rows, sorting, pagination**, and cache-class.

## Notes

- Grilling ticket: consult `grilling` + `domain-modeling`; `to-spec` when writing.
- Uses the exact ratio definitions from ticket 10; do not redefine them.


## Answer

The basic-screener backend spec. A **pure-SQL projection over already-ingested
Postgres**, no JobBus dependency, reading the entities/ratios fixed by
[Decide: the free-tier domain model](10-free-tier-domain-model.md). Nothing here
redefines a ratio; every formula is the ticket-10 definition, already in
`apps/backend/CONTEXT.md`.

### 1. Filter set (demo baseline)

Adopts research 03's recommended demo set, mapped onto ticket-10 entities. Two
groups: **fundamental** (available now, over synthetic-but-reconciled data) and a
**technical extension** (reads `IndicatorSnapshot`, shippable in the same query
since ticket 07 writes the snapshot nightly).

**Universe**
- `board` — enum `MAIN` | `ACE` (the analysed universe is ordinary shares of
  Main+ACE only, ticket 10). No REIT/ETF/warrant rows reach the screener.
- `sector` — FK to the Bursa `Sector` reference entity (id list; no string match).
- `shariah` — boolean over the **latest** `ShariahStatus` row per company
  (`status = COMPLIANT` as of its most recent `effectiveDate`).

**Price / liquidity** (over `FundamentalsSnapshot` + latest close from the price
bar / `IndicatorSnapshot.latestClose`)
- `price` min/max, `volume` min (latest bar volume), `marketCap` min/max band
  (market cap = latest close × shares outstanding, ticket 10).

**Valuation** (derived ratios, ticket 10 formulas, materialised on
`FundamentalsSnapshot`)
- `pe` min/max, `dy` min/max, `pNta` min/max.

**Quality**
- `roe` min/max, `de` min/max, `profitableYears` min (count of consecutive
  trailing full years with positive annual net profit, from `QuarterlyFinancials`).

**Growth**
- `yoyProfitGrowth` min (latest quarter net profit vs. same quarter prior year),
  and `consecutiveGrowthQuarters` min (N consecutive positive-YoY quarters) — both
  ticket-10 definitions.

**Technical extension** (reads latest `IndicatorSnapshot`; ships in demo because
ticket 07 already writes it nightly in TS)
- `rsi14` min/max, and a **`priceVsSma` flag** (close above/below SMA-50 and
  SMA-200) exposed as discrete filters `aboveSma50`, `aboveSma200`. Stochastic
  from research 03 is **deferred** (not in ticket-10's fixed indicator set: SMA-
  20/50/200, RSI-14, MACD, 52-wk hi/lo) — adding it means widening the snapshot,
  an ingestion change out of this spec's scope.

Every filter is optional and AND-combined. Absent params impose no constraint.

### 2. Query shape

- **Single read model:** `Instrument` ⋈ `Company` ⋈ `FundamentalsSnapshot`
  (per-company latest) ⋈ latest `IndicatorSnapshot` (per-instrument) ⋈ `Sector` ⋈
  latest `ShariahStatus`. All joins are to the **latest** derived rows, which the
  ingestion worker already maintains as single-current-row tables
  (`FundamentalsSnapshot`, `IndicatorSnapshot`) or resolvable by max-effectiveDate
  (`ShariahStatus`). No window functions needed at query time — 52-wk hi/lo etc.
  are already materialised onto `IndicatorSnapshot` by ticket 07.
- **Ratios are read, not computed at query time.** They are materialised onto
  `FundamentalsSnapshot` during ingest (ticket 07 recomputes after each quarterly
  ingest). The screener filters on stored columns → plain indexed SQL over ~1,000
  KLSE rows (research 03: trivially cheap).
- **Null-ratio handling (ticket 10):** `P/E` is NULL for loss-making companies
  (TTM EPS ≤ 0). SQL semantics already exclude NULLs from `pe <= X` / `pe >= X`, so
  a loss-maker never satisfies a P/E band — matches the ticket-10 rule
  ("`P/E < X` excludes nulls") for free. Same for any other NULL ratio (e.g. DY
  NULL when no trailing dividends). A **`peNull` companion flag** is *not* a filter;
  loss-makers are simply absent from any P/E-bounded screen.

### 3. Result rows, sorting, pagination

- **Result row:** `stockCode`, `shortName`, `sector`, latest `close`, `%change`
  (latest bar), `marketCap`, the filtered ratios (`pe`, `dy`, `pNta`, `roe`, `de`),
  and a **`provenance`** field per numeric class (join to `IngestionRun`), so the
  frontend renders the "illustrative" label on synthetic price/ratio columns
  (decision 04 / ticket 10 lineage). Reference fields (code/name/sector) are `real`.
- **Sorting:** default sort **`%change` desc** (research 03's recommended default);
  sortable on any returned numeric column, asc/desc. NULLs sort last regardless of
  direction (loss-maker P/E, missing DY) so they never crowd the head of a ranking.
- **Pagination:** offset/limit, default limit 50, max 100. Total match count
  returned for the result header. (No vendor 1,000-row cap — research 03 rejected
  proxying EODHD's screener; we own the rows.)

### 4. Cache-class (ADR-0004)

**Class 2 — aggregated dashboard view.** A screen result is a deterministic
function of the nightly-ingested snapshot, so cache the result set **keyed by the
normalised filter+sort+page params**, TTL of minutes–hours, and **invalidate on the
nightly ingest** (same trigger that rewrites `FundamentalsSnapshot` /
`IndicatorSnapshot`). Not class 1 (that's AI results) and not class 3 (no live
intraday — the screener reads EOD-derived snapshots, not the 5-min Redis replay).
Intraday price drift within a day is acceptable for a screener over EOD
fundamentals.

### Endpoint

- `GET /screener` — query params = the filter set above + `sort`, `dir`, `offset`,
  `limit`. Anonymous-accessible (browsing is anonymous, map Notes); subject to the
  still-open cross-cutting anonymous read-API rate-limit posture (map "Not yet
  specified"), not re-decided here.
- A companion `GET /screener/fields` (or static contract) advertises the available
  filter fields + their sector/board enum domains so the frontend builds the form
  without hardcoding.

### Deferred / out of this spec

- **Stochastic** filter (needs a wider `IndicatorSnapshot` → ingestion change).
- **QoQ growth, top-quarter, debt/cash** from research 03's fuller KLSE-Screener
  set — not in the ticket-10 fixed ratio set; add later behind the same read model
  if demanded.
- **Saved screens / screen-to-watchlist** (account-bound; belongs to the
  watchlist+accounts spec area, still fog).
- **Anonymous rate-limiting / abuse posture** — cross-cutting, map "Not yet
  specified".

No new fog surfaced toward the destination; no ticket invalidated. This spec area
is ready for `to-spec` at the end of the map alongside the other per-feature areas.
