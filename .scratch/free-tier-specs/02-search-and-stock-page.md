# Spec: Free-tier search + stock page (backend)

Status: ready-for-agent

> Handoff spec produced by `to-spec` from the free-tier wayfinder map. Source
> decision: [search + stock page spec](../free-tier/issues/11-search-and-stock-page-spec.md).
> **Depends on** [Spec 01: data ingestion + domain model](01-data-ingestion-and-domain-model.md)
> — reads its entities and ratios, redefines nothing.

## Problem Statement

A user landing on the demo needs to find a Bursa stock by code or name and then see a
single consolidated page for it: identity, valuation, quality, technicals, Shariah
status, and recent disclosures — with synthetic figures honestly labelled. There is no
search or stock-page backend yet.

## Solution

Two anonymous read endpoints over the already-ingested Postgres model (no JobBus). A
trigram-ranked instrument search, and a stock page in **endpoint shape B**: a bounded
core snapshot plus separate paginated disclosure lists. Every block carries a
per-data-class provenance tag so the frontend renders the "illustrative data" label
where data is synthetic.

## User Stories

1. As a user, I want to type a 4-digit stock code and get that stock, so that exact
   lookups are instant and unambiguous.
2. As a user, I want to type part of a code and see matching codes, so that I can find
   a stock I only partly remember.
3. As a user, I want to type a company name (even slightly misspelled, e.g. "maybnk")
   and still find it, so that I don't need the exact spelling.
4. As a user, I want name matches ranked sensibly (exact code → code prefix → name
   prefix → fuzzy), so that the most likely result is at the top.
5. As a user, I want to search without signing in, so that browsing is frictionless.
6. As a user, I want one stock page that shows identity, fundamentals + ratios,
   technicals, and Shariah status in a single load, so that I get the whole picture
   without many requests.
7. As a user, I want the announcements and corporate actions for a stock as separate
   paginated lists, so that long histories don't bloat the core page.
8. As a user, I want synthetic price/fundamental blocks clearly labelled
   "illustrative", so that I don't mistake demo figures for real market data.
9. As a user, I want a loss-making company to show "N/A (loss-making)" for P/E rather
   than a negative or misleading number, so that valuation reads honestly.
10. As the platform operator, I want search to stay correct at full-exchange scale
    without an external search engine, so that we don't add infrastructure we don't need.

## Implementation Decisions

### Search matching

- **Trigram fuzzy search over `Instrument`** identity columns only: `stockCode`,
  `shortName`, `fullName`.
- **Rank bands** (first band with hits wins; within a band, order by the next rule):
  1. Exact `stockCode` (always rank 1).
  2. `stockCode` prefix.
  3. Name prefix (case-insensitive; `shortName` hit outranks `fullName` hit).
  4. Trigram similarity (`pg_trgm` `similarity()` desc; short-name over full-name on ties).
- **Implementation:** Postgres `pg_trgm` + a **GIN trigram index** on the name columns
  (migration owned by this build). Correct at demo (~1k) and full-Bursa
  (low-tens-of-thousands incl. non-analysed search rows) scale — `pg_trgm` scales to
  millions, so **row count never bites**. **No external search engine** (YAGNI); behind
  an `InstrumentSearch` repository seam so it *could* be swapped, but not built for.
- **Universe:** search returns the analysed universe (Main+ACE ordinary shares).
  IPO-calendar-only non-ordinary lines are not searchable (no stock page).
- The only real scaling lever is request volume → the cross-cutting anonymous
  rate-limit posture (out of scope here).

### Stock-page payload — endpoint shape B

Chosen B (bounded core + separate paginated lists) over A (one fat endpoint): bounds
the core payload, paginates growing lists, avoids duplicating spec 04's feed logic.

- **Core `GET /stocks/:code`** — one round trip:
  - **Identity:** `Instrument` (code, shortName, fullName, board) ⋈ `Company`
    (name, `Sector`).
  - **Fundamentals:** latest `FundamentalsSnapshot` + **derived ratios read from it**
    (P/E, DY, P/NTA, ROE, D/E, PSR — spec-01 formulas, materialised, read not computed)
    + the loss-making flag (P/E null when TTM EPS ≤ 0).
  - **Technicals:** latest `IndicatorSnapshot` (SMA-20/50/200, RSI-14, MACD, 52-wk
    hi/lo, latest close, %change).
  - **Shariah:** latest `ShariahStatus` (value + effectiveDate).
  - Does **not** inline the disclosure lists.
- **`GET /stocks/:code/announcements?offset=&limit=`** — newest `filedAt` first;
  category taxonomy + AI-summary field owned by **spec 04**, referenced not redefined;
  reads spec-04's read model scoped to one company.
- **`GET /stocks/:code/corporate-actions?offset=&limit=`** — chronological; reads
  `CorporateAction`; aligned with spec-04's corporate-actions calendar, scoped to one
  company.

### Illustrative labelling (provenance)

Read-time `IngestionRun` lineage join (spec 01: lineage, not a per-row column). Core
payload groups fields by data class, each carrying one `provenance` descriptor:
- Identity + Shariah → `real` (public reference).
- Fundamentals + price-derived ratios + technicals → `synthetic` → "illustrative data".
- Announcements + corporate-actions → `aggregator` (demo-only; decision-B purge marker).

### Cache-class (ADR-0004)

- **`GET /search`** — class 2; key on normalised query; invalidate on roster change (rare).
- **`GET /stocks/:code` core** — class 2 (EOD-derived); keyed by code; invalidated on
  nightly ingest. **Header close/%change is the EOD snapshot**, not the 5-min replay.
- **`GET /stocks/:code/{announcements,corporate-actions}`** — class 2, keyed by
  code+page; invalidated on the disclosure snapshot ingest.

### Endpoints (summary)

- `GET /search?q=` — anonymous, trigram-ranked matches.
- `GET /stocks/:code` — anonymous, composed snapshot.
- `GET /stocks/:code/announcements?offset=&limit=` — anonymous, paginated.
- `GET /stocks/:code/corporate-actions?offset=&limit=` — anonymous, paginated.

## Testing Decisions

- **Good test = external behaviour.** Test ranking order, fuzzy hits, payload
  composition, provenance tagging, pagination — not repository internals.
- **Search ranking tests:** table-driven queries asserting the band order (exact code,
  code prefix, name prefix, fuzzy "maybnk"→Maybank), short-name-over-full-name ties.
- **Stock-page composition test:** seed one instrument with fundamentals/indicator/
  Shariah rows; assert the core payload has correct ratios (read, matching spec-01
  formulas) and the loss-maker shows P/E null.
- **Provenance test:** assert each block's `provenance` matches its ingestion-run class.
- **Pagination tests:** offset/limit bounds, total count, ordering on the list endpoints.
- **Integration** via testcontainers Postgres (ADR-0011), incl. the `pg_trgm` GIN index.
- Prior art: `apps/backend` controller/integration tests.

## Out of Scope

- **Live intraday header quote** (would pull one field into class-3 Redis replay) —
  deferred; header reads the EOD snapshot.
- **Announcement category taxonomy + AI-summary shape** — owned by spec 04.
- **OHLC / chart-data series endpoints** — still fog (charting data).
- **Announcement/news body full-text search** — not a free-tier feature; instrument
  name/code search only.
- **Anonymous rate-limit / abuse posture** — cross-cutting open question.
- **Watchlist "add from stock page"** — account-bound; watchlist area (still fog).

## Further Notes

- No new ADR flagged by this spec. Uses spec-01's model and candidate ADR-0012.
- All terms are in `apps/backend/CONTEXT.md`.
