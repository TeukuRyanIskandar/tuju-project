# Spec: market overview (free-tier backend)

Type: grilling
Status: resolved
Blocked by: 10

## Question

With the domain model fixed ([Decide: the free-tier domain model](10-free-tier-domain-model.md)),
produce the handoff spec for the **market overview** backend.

Decide (inside this spec):
- **Movers definition:** the universe for top gainers/losers/actives (whole analysed
  universe? penny-stock/min-liquidity filter?), computed over synthetic EOD/intraday
  bars.
- **Index panel:** the synthetic index series (decision 04) surfaced with the
  illustrative label.
- **Sector performance** rollups over the Sector reference entity.
- Cadence alignment with ticket 07 (nightly EOD, 5-min intraday replay to Redis),
  cache-class per panel.

## Notes

- Grilling ticket: consult `grilling` + `domain-modeling`; `to-spec` when writing.
- Movers/penny-stock filter was explicitly flagged as per-feature fog in ticket 10's
  parent; sharpen it here.


## Answer

The market-overview backend spec. Three panels — **movers**, **index**, **sector
performance** — over the entities fixed by
[Decide: the free-tier domain model](10-free-tier-domain-model.md) and the cadences
fixed by [Decide: ingestion pipeline shape](07-ingestion-pipeline-shape.md). One new
entity pair (`MarketIndex` + `IndexLevel`) is introduced here behind the ticket-04
source-adapter seam; everything else reads existing tables.

### 1. Movers — whole analysed universe, no filter

- **Universe = the whole analysed universe** (ordinary shares of Main+ACE, ticket 10).
  Top gainers / losers / most-active computed by `ORDER BY %change` (and by volume
  for actives) over all ~1,000 rows. **No penny-stock / min-liquidity / min-market-cap
  floor** — the per-feature fog flagged in ticket 10's parent is resolved **simplest
  (option A)**: no threshold parameter to justify. (Accepted trade-off: on synthetic
  prices the board may surface micro-cap noise; acceptable for the demo, and a floor
  can be added later behind the same read model if a partner reacts to it.)
- **Source = the 5-min synthetic intraday replay** (ticket 07, Redis-only) during
  market hours; falls back to the **nightly EOD close** outside hours.
- **Precomputed into the 5-min Redis write**, so the endpoint is a pure read — keeps
  intraday **Redis-only, never Postgres** (ticket 07 / ADR-0004 rule).

### 2. Index panel — stored `MarketIndex` + `IndexLevel`, cap-weighted, behind an `IndexAdapter`

- **New entities** (added to ticket 10's model): **`MarketIndex`** (reference entity:
  a FBM KLCI analogue + a handful of per-`Sector` indices) and **`IndexLevel`** (a
  level per index per day — a time series parallel to price bars, so the index is
  chartable). `IndexLevel` carries **`IngestionRun` provenance** (ticket-10 lineage,
  not a per-row marker), so synthetic levels surface the "illustrative" label and are
  purgeable by run.
- **Computed cap-weighted** (real FBM KLCI methodology) over the synthetic constituent
  bars by the ingestion worker, **nightly** to Postgres (the daily series) **plus** a
  **live level recomputed in the 5-min Redis replay** (cap-weight the live constituent
  snapshot).
- **Behind an `IndexAdapter` on the source-adapter seam** (decision 04). Demo =
  `SyntheticIndexAdapter` (cap-weights synthetic constituents, tagged `synthetic`);
  the endpoints/entities/read model are **identical in production**, where the level
  stops being computed and is either **ingested from a licensed index feed**
  (`LicensedIndexAdapter`, tagged `real`) or **recomputed cap-weighted over real
  licensed prices** as a branded house index. **Whether FBM KLCI specifically may be
  shown in production is a licensing question deferred to the architecture map's
  [vendor-verification task](../../architecture/issues/10-data-vendor-verification.md)** —
  official/licensed indices can't be republished without a redistribution licence, the
  same class of problem as prices (decision 04). Not decided here; the seam makes it a
  swap, not a rebuild.

### 3. Sector performance — reads the per-`Sector` `IndexLevel`s

- **Same machinery as the index panel, scoped per `Sector`.** Each Bursa `Sector`
  (ticket 10 reference entity) has its own `MarketIndex` row; sector performance is a
  plain read over those `IndexLevel`s (live from Redis during hours, latest Postgres
  otherwise). **Cap-weighted**, consistent with the headline index. No separate
  request-time aggregate — building the sector indices as first-class `MarketIndex`
  rows means "sector performance" is just reading them.

### 4. Cadence + cache-class alignment (ADR-0004 3-class Redis cache)

The through-line: **anything intraday-live is class 3 (Redis-only); anything
EOD-derived and stored is class 2 (Postgres-backed). Nothing is class 1 (AI results).**

| Panel | During market hours (09:00–16:45 MYT) | Outside hours / history |
| --- | --- | --- |
| Movers board | precomputed in the 5-min Redis replay → **class 3** | latest EOD close → **class 2** |
| Index headline (live level) | recomputed in the 5-min Redis replay → **class 3** | latest `IndexLevel` (Postgres) → **class 2** |
| Index / sector history (sparkline, chart series) | stored `IndexLevel` series (Postgres) → **class 2** | same |
| Sector performance | live per-`Sector` level from Redis → **class 3** | latest per-`Sector` `IndexLevel` → **class 2** |

Matches ticket 07 exactly (nightly EOD + indicator snapshots to Postgres; 5-min
intraday replay to Redis-only; intraday never touches Postgres).

### Endpoints (anonymous; browsing is anonymous, map Notes)

- `GET /market/movers` — `?type=gainers|losers|actives`, `limit` (default 10).
- `GET /market/indices` — the headline index + sector indices, current level + %change,
  with `provenance` for the illustrative label.
- `GET /market/indices/:id/series` — the `IndexLevel` history for one index (range
  toggle), for the index sparkline/chart.
- `GET /market/sectors` — sector-performance board (per-`Sector` %change).

All subject to the still-open cross-cutting **anonymous read-API rate-limit posture**
(map "Not yet specified"), not re-decided here.

### New domain terms (added to `apps/backend/CONTEXT.md`)

- **Market index** — a `MarketIndex` reference entity (a FBM KLCI analogue + per-Sector
  indices); its level is `IndexLevel`, a daily time series parallel to price bars.
- **Index level** — one cap-weighted level per index per day (plus a live intraday level
  in Redis), carrying `IngestionRun` provenance. Computed in the demo, ingested or
  recomputed in production behind the `IndexAdapter`.
- **Index adapter** — the source-adapter-seam method serving index levels; demo
  cap-weights synthetic constituents, production ingests a licensed feed or recomputes
  over real prices.

### Deferred / out of this spec

- **Movers liquidity/market-cap floor** — deliberately not added (option A); revisit if
  a partner reacts to synthetic micro-cap noise.
- **Official-index licensing (may we show "FBM KLCI"?)** — architecture map's
  vendor-verification task, not this map.
- **Index chart component / overlays** — frontend, out of scope; only the index *series
  data* endpoint is in scope.
- **Anonymous rate-limiting / abuse posture** — cross-cutting, map "Not yet specified".

### New fog / model change surfaced

- **`MarketIndex` + `IndexLevel` are a genuine addition to ticket 10's entity set.**
  Ticket 10 is resolved; rather than reopen it, this spec owns the two new entities and
  flags them so `to-spec` folds them into the shared model (and the glossary is updated
  now). No ticket invalidated. No new fog *toward the destination* (the index series
  endpoint shape overlaps the still-fogged charting-data endpoints, but that fog already
  exists and is unchanged).

Ready for `to-spec` at the end of the map alongside the other per-feature areas.
