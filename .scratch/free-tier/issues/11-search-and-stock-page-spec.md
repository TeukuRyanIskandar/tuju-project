# Spec: search + stock page (free-tier backend)

Type: grilling
Status: resolved
Blocked by: 10

## Question

With the shared domain model fixed ([Decide: the free-tier domain model](10-free-tier-domain-model.md)),
produce the handoff spec for **search + the stock page** backend.

Decide (inside this spec):
- **Search matching:** stock code vs. short name vs. full name; exact-first then
  fuzzy; ranking; how the anonymous path reaches it.
- **Stock page payload:** which entities compose it (Instrument + Company +
  FundamentalsSnapshot + latest IndicatorSnapshot + latest ShariahStatus + recent
  Announcements/CorporateActions + derived ratios), and the endpoint shape.
- **Illustrative labelling:** how the read-time provenance join surfaces the
  "illustrative data" label per data class on the page.
- Cache-class assignment per endpoint (ADR-0004 3-class Redis cache).

## Notes

- Grilling ticket: consult `grilling` + `domain-modeling`; `to-spec` when writing.
- Builds directly on the entities and ratio definitions pinned in ticket 10.


## Answer

The search + stock-page backend spec. A **pure read projection over already-ingested
Postgres**, no JobBus dependency, reading the entities/ratios fixed by
[Decide: the free-tier domain model](10-free-tier-domain-model.md). Nothing here
redefines a ratio or an entity; every formula is the ticket-10 definition already in
`apps/backend/CONTEXT.md`. Sibling precedent: the
[screener spec](12-screener-spec.md) and [market-overview spec](14-market-overview-spec.md).

### 1. Search matching

**Trigram fuzzy search over `Instrument`, correct at demo *and* production scale.**
Search targets only the instrument identity columns fixed by ticket 10: `stockCode`
(stable 4-digit Bursa code, unique natural key), `shortName`, `fullName`.

**Match + rank order** (first tier that produces hits wins its rank band; results
within a band ordered by the next rule):

1. **Exact `stockCode`** — e.g. `1155` → the instrument. Deterministic, always rank 1.
2. **`stockCode` prefix** — `115` → codes starting `115`.
3. **Name prefix** — case-insensitive prefix on `shortName`, then `fullName`
   (short-name hit outranks full-name hit).
4. **Name substring / trigram similarity** — `pg_trgm` similarity over
   `shortName`/`fullName` so `maybnk` still finds Maybank; ordered by descending
   `similarity()` score, short-name over full-name on ties.

Implementation: Postgres `pg_trgm` extension + a **GIN trigram index** on the name
columns (a migration owned by the build effort). At ~1,000 (demo) to low-tens-of-
thousands (full Bursa universe incl. non-analysed REIT/ETF/warrant search rows) rows,
lookups are sub-millisecond; `pg_trgm` is comfortable into the millions, so the
**row-count axis never becomes a scaling concern** — the universe is bounded by a real
exchange, not user-generated growth. The only search scaling lever is **request
volume on an anonymous endpoint**, which is the cross-cutting anonymous read-API
rate-limit posture (map "Not yet specified"), *not* a matching-engine choice — an
external engine (Elasticsearch/Meilisearch) would not fix an unthrottled endpoint,
only move its cost. **Decision: no external search engine** (YAGNI at this scale);
search sits behind an `InstrumentSearch` repository method so the engine *could* be
swapped later without touching consumers, but we do not build for that.

**Scope note:** full-text search over announcement/news *bodies* is a different
problem (Postgres FTS `tsvector` or a dedicated engine) and is **out of this spec** —
ticket 13 keeps news to headline+link, and announcement search is not a free-tier
feature. Instrument name/code search stays trivially small forever.

- **Universe:** search returns the **analysed universe** (Main+ACE ordinary shares,
  ticket 10). IPO-calendar-only non-ordinary lines are not searchable instruments
  (they have no stock page); they live in the IPO calendar area.
- **Anonymous path:** browsing is anonymous (map Notes), so `GET /search` needs no
  session; subject only to the still-open cross-cutting rate-limit posture.

### 2. Stock-page payload — endpoint shape **B**

Chosen **B** (bounded core + separate paginated lists) over A (one fat endpoint):
keeps the core payload bounded, lets the growing announcement/action lists paginate,
and avoids duplicating ticket 13's feed logic inline.

**Core: `GET /stocks/:code`** composes the per-instrument snapshot in one round trip:
- **Identity:** `Instrument` (stockCode, shortName, fullName, board) ⋈ `Company`
  (name, `Sector`).
- **Fundamentals:** latest `FundamentalsSnapshot` (TTM figures, latest NTA, shares
  outstanding) + **derived ratios read from it** (P/E, DY, P/NTA, ROE, D/E, PSR —
  ticket-10 formulas, materialised by ticket 07, *read not computed*), plus the
  derived **loss-making** flag (P/E null when TTM EPS ≤ 0).
- **Technicals:** latest `IndicatorSnapshot` (SMA-20/50/200, RSI-14, MACD, 52-wk
  hi/lo, latest close, %change).
- **Shariah:** latest `ShariahStatus` (current value + effectiveDate).
- Does **not** inline the announcement/action lists.

**Lists (separate, paginated):**
- **`GET /stocks/:code/announcements`** — offset/limit, newest `filedAt` first;
  category taxonomy + optional AI **announcement-summary** field are owned by
  [ticket 13](13-announcements-news-events-spec.md); this spec **references** that
  shape rather than redefining it (per grilling call 3). The stock page consumes the
  same read model ticket 13 defines, scoped to one company.
- **`GET /stocks/:code/corporate-actions`** — offset/limit, chronological; reads
  `CorporateAction` (dividends/bonus/split/rights). Shape aligned with ticket 13's
  corporate-actions calendar, scoped to one company.

### 3. Illustrative labelling (provenance)

Same read-time lineage join as the screener/market-overview specs (ticket 10:
provenance is `IngestionRun` lineage, **not** a per-row column). The core payload
carries a **per-data-class `provenance`** descriptor (`synthetic` / `aggregator` /
`real`) resolved by joining each sourced row to its `IngestionRun`:
- Identity (code/name/sector/board), Shariah status → `real` (public reference).
- Fundamentals + all price-derived ratios + technicals → `synthetic` (co-generated,
  decision A1) → frontend renders the **"illustrative data"** label on those blocks.
- Announcements/corporate-actions → `aggregator` (demo-only snapshot, carries the
  decision-B purge marker via lineage) → labelled accordingly.

The payload groups fields by data class so a single `provenance` tag covers each
block rather than repeating per field.

### 4. Cache-class (ADR-0004)

- **`GET /search`** — **class 2** (aggregated view). Deterministic over the ingested
  instrument set; key on the normalised query string; invalidate on the reference/
  ingest run that changes the instrument roster (rare). Short TTL is safe.
- **`GET /stocks/:code` core** — **class 2** (EOD-derived snapshot: fundamentals +
  nightly indicators). Keyed by code; invalidated on the nightly ingest that rewrites
  `FundamentalsSnapshot`/`IndicatorSnapshot`. **Latest close/%change is EOD-derived
  here** (the stock-page header reads the snapshot, not the 5-min replay) — matching
  the screener's stance that intraday drift within a day is acceptable for a
  snapshot view. If a live intraday quote is later wanted on the header, that single
  field graduates to class 3 (Redis-only replay), same as market-overview movers;
  noted, not built now.
- **`GET /stocks/:code/{announcements,corporate-actions}`** — **class 2**, keyed by
  code+page; invalidated on the disclosure snapshot ingest (ticket 13's cadence).

Not class 1 (that's AI job results) and not class 3 (no live intraday in this spec's
core reads).

### Endpoints (summary)

- `GET /search?q=` — anonymous; trigram-ranked instrument matches.
- `GET /stocks/:code` — anonymous; composed per-instrument snapshot.
- `GET /stocks/:code/announcements?offset=&limit=` — anonymous; paginated, ticket-13
  read model scoped to one company.
- `GET /stocks/:code/corporate-actions?offset=&limit=` — anonymous; paginated.

### Deferred / out of this spec

- **Live intraday header quote** on the stock page (would pull one field into
  class-3 Redis replay) — deferred; core header reads the EOD snapshot.
- **Announcement category taxonomy + AI-summary field shape** — owned by ticket 13;
  referenced here.
- **OHLC / chart-data series endpoints** — remain map fog ("Charting data"); the
  stock page links to them once specified but does not define them.
- **Anonymous rate-limiting / abuse posture** — cross-cutting, map "Not yet
  specified"; the sole real scaling lever for `/search`.
- **Watchlist "add from stock page"** — account-bound; belongs to the
  watchlist+accounts area (still fog).

No new fog surfaced toward the destination; no ticket invalidated. This spec area is
ready for `to-spec` at the end of the map alongside the other per-feature areas.
