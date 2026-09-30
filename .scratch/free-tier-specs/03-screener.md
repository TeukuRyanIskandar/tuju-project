# Spec: Free-tier screener (backend)

Status: ready-for-agent

> Handoff spec produced by `to-spec` from the free-tier wayfinder map. Source
> decision: [screener spec](../free-tier/issues/12-screener-spec.md).
> **Depends on** [Spec 01: data ingestion + domain model](01-data-ingestion-and-domain-model.md)
> — reads its entities and ratios, redefines nothing.

## Problem Statement

A user wants to filter the Bursa universe down to stocks matching valuation, quality,
growth, and technical criteria (a basic stock screener). There is no screener backend,
and vendor screeners either lack the KLSE fields (EODHD's 14-field screener has no
P/E/ROE/NTA/Shariah) or cap rows — so we must screen our own data.

## Solution

A single anonymous `GET /screener` endpoint that filters our own ingested Postgres —
plain indexed SQL over the ~1,000-row analysed universe, joining the latest derived
snapshot rows. All ratios are **read** from materialised columns (computed at ingest,
spec 01), never at query time. Results carry per-class provenance for the illustrative
label, sort by any numeric column (default `%change` desc), and paginate.

## User Stories

1. As a user, I want to filter by sector, board, and Shariah compliance, so that I can
   scope the universe to what I care about.
2. As a user, I want to filter by price, volume, and market-cap bands, so that I can
   exclude illiquid or out-of-range stocks.
3. As a user, I want to filter by valuation ratios (P/E, DY, P/NTA), so that I can find
   cheap or high-yield stocks.
4. As a user, I want to filter by quality (ROE, D/E, profitable years), so that I can
   avoid weak balance sheets.
5. As a user, I want to filter by growth (YoY profit growth, consecutive growth
   quarters), so that I can find improving companies.
6. As a user, I want a technical filter (RSI-14, above SMA-50/200), so that I can
   combine fundamentals with momentum.
7. As a user, I want loss-making companies excluded from any P/E band automatically, so
   that a `P/E < X` screen isn't polluted by negative-earnings names.
8. As a user, I want to sort results by any column and paginate, so that I can rank and
   browse the matches.
9. As a user, I want each result to show a total match count, so that I know how broad
   my screen is.
10. As a user, I want synthetic price/ratio columns labelled "illustrative", so that I
    read the numbers honestly.
11. As a frontend developer, I want a fields endpoint advertising available filters and
    their enum domains, so that I build the form without hardcoding.

## Implementation Decisions

### Filter set (research-03 baseline mapped to spec-01 entities)

All filters optional, AND-combined; absent params impose no constraint.

- **Universe:** `board` (`MAIN`|`ACE`), `sector` (FK id list, no string match),
  `shariah` (boolean over the **latest** `ShariahStatus` per company).
- **Price/liquidity:** `price` min/max, `volume` min, `marketCap` min/max
  (= latest close × shares outstanding).
- **Valuation:** `pe`, `dy`, `pNta` min/max.
- **Quality:** `roe`, `de` min/max, `profitableYears` min.
- **Growth:** `yoyProfitGrowth` min, `consecutiveGrowthQuarters` min.
- **Technical extension** (reads latest `IndicatorSnapshot`; ships now because spec 01
  writes it nightly): `rsi14` min/max, discrete flags `aboveSma50`, `aboveSma200`.
  **Stochastic deferred** (outside spec-01's fixed indicator set → would need a wider
  snapshot, an ingestion change).

### Query shape

- **Single read model:** `Instrument` ⋈ `Company` ⋈ latest `FundamentalsSnapshot` ⋈
  latest `IndicatorSnapshot` ⋈ `Sector` ⋈ latest `ShariahStatus`. Latest derived rows
  are single-current-row tables or resolvable by max-effectiveDate; **no window
  functions at query time** (52-wk hi/lo etc. already materialised by spec 01).
- **Ratios are read, not computed** — materialised on `FundamentalsSnapshot` at ingest.
  Plain indexed SQL over ~1,000 rows.
- **Null handling:** P/E is NULL for loss-makers (TTM EPS ≤ 0); SQL semantics exclude
  NULLs from `pe <= X`/`pe >= X` for free (matches the spec-01 rule). Same for any NULL
  ratio (e.g. DY when no trailing dividends). No `peNull` filter — loss-makers are
  simply absent from any P/E-bounded screen.

### Result rows, sorting, pagination

- **Row:** `stockCode`, `shortName`, `sector`, latest `close`, `%change`, `marketCap`,
  the filtered ratios (`pe`, `dy`, `pNta`, `roe`, `de`), and per-numeric-class
  `provenance` (IngestionRun lineage) for the illustrative label. Reference fields
  (code/name/sector) are `real`.
- **Sorting:** default `%change` desc; sortable on any returned numeric column, asc/desc.
  **NULLs sort last** regardless of direction.
- **Pagination:** offset/limit, default 50, max 100; total match count returned. No
  vendor row cap (we own the rows).

### Cache-class (ADR-0004)

**Class 2 — aggregated view.** Deterministic over the nightly snapshot; key on the
normalised filter+sort+page params; TTL minutes–hours; **invalidate on nightly ingest**.
Not class 1 (AI results) or class 3 (no live intraday — screener reads EOD snapshots).

### Endpoints

- `GET /screener` — params = the filter set + `sort`, `dir`, `offset`, `limit`; anonymous.
- `GET /screener/fields` — advertises available filters + sector/board enum domains.

## Testing Decisions

- **Good test = external behaviour** (which stocks a filter returns, ordering, counts),
  not SQL internals.
- **Filter tests:** table-driven — each filter class over a seeded universe asserts the
  right rows in/out (incl. loss-maker excluded from a P/E band, Shariah boolean over
  latest status).
- **Sort/pagination tests:** default `%change` desc, NULLs-last, offset/limit bounds,
  total count.
- **Provenance test:** synthetic price/ratio columns tagged `synthetic`, reference
  fields `real`.
- **Cache test:** result keyed by normalised params; invalidated on a simulated nightly
  ingest.
- **Integration** via testcontainers Postgres (ADR-0011).
- Prior art: `apps/backend` controller/integration tests.

## Out of Scope

- **Stochastic** filter (needs a wider `IndicatorSnapshot` → ingestion change).
- **QoQ growth, top-quarter, debt/cash** and the fuller KLSE-Screener set — add later
  behind the same read model if demanded.
- **Saved screens / screen-to-watchlist** — account-bound; watchlist area (still fog).
- **Anonymous rate-limit / abuse posture** — cross-cutting open question.

## Further Notes

- No new ADR flagged by this spec. Uses spec-01's model and candidate ADR-0012.
- All terms are in `apps/backend/CONTEXT.md`.
