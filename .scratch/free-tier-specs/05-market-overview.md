# Spec: Free-tier market overview (backend)

Status: ready-for-agent

> Handoff spec produced by `to-spec` from the free-tier wayfinder map. Source
> decision: [market overview spec](../free-tier/issues/14-market-overview-spec.md).
> **Depends on** [Spec 01: data ingestion + domain model](01-data-ingestion-and-domain-model.md).
> **Introduces** the `MarketIndex` / `IndexLevel` / `IndexAdapter` addition to the
> shared model (spec 01 owns the base model; this spec owns this addition).

## Problem Statement

The demo dashboard needs a market-overview surface: top movers (gainers/losers/most
active), a headline index with sector indices, and sector performance — over the
demo's synthetic prices, honestly labelled, and respecting the "intraday never touches
Postgres" rule. There is no market-overview backend, and no index entity exists yet.

## Solution

Three read panels — movers, index, sector performance — over the ingested model plus a
new stored `MarketIndex` / `IndexLevel` pair computed cap-weighted behind an
`IndexAdapter` on the source-adapter seam. Live intraday values come from the 5-min
Redis replay (class 3); EOD-derived and historical series come from Postgres (class 2).
The index machinery is identical in production, where the level is ingested from a
licensed feed or recomputed over real prices.

## User Stories

1. As a user, I want top gainers, losers, and most-active stocks, so that I can see
   what's moving today.
2. As a user, I want the movers board to update through the trading day, so that it
   feels live (delayed intraday is acceptable).
3. As a user, I want a headline market index with its level and %change, so that I can
   gauge the overall market.
4. As a user, I want per-sector indices and a sector-performance board, so that I can
   see which sectors lead or lag.
5. As a user, I want an index series I can chart (sparkline / range toggle), so that I
   can see the index trend.
6. As a user, I want index and mover values labelled "illustrative", so that I read
   synthetic figures honestly.
7. As the platform operator, I want the index machinery to be a seam swap for a
   licensed feed or a house index in production, so that going live is a swap, not a
   rebuild.
8. As the platform operator, I want intraday values to live in Redis only, so that the
   ADR-0004 ephemeral-intraday posture holds.

## Implementation Decisions

### 1. Movers — whole analysed universe, no filter (option A)

- **Universe = the whole analysed universe** (Main+ACE ordinary shares). Gainers/losers
  by `%change`, most-active by volume, over all ~1,000 rows. **No penny-stock /
  min-liquidity / min-market-cap floor** — the simplest resolution of the movers-fog;
  no threshold parameter to justify. Accepted trade-off: synthetic prices may surface
  micro-cap noise; a floor can be added later behind the same read model.
- **Source:** the 5-min synthetic intraday replay (Redis-only) during market hours;
  nightly EOD close fallback outside hours.
- **Precomputed into the 5-min Redis write**, so the endpoint is a pure read — intraday
  stays Redis-only, never Postgres.

### 2. Index panel — stored `MarketIndex` + `IndexLevel`, cap-weighted, behind `IndexAdapter`

- **New entities (addition to spec 01's model):**
  - **`MarketIndex`** — reference entity: a FBM KLCI analogue + per-`Sector` indices.
  - **`IndexLevel`** — one level per index per day (a series parallel to price bars, so
    the index is chartable) + a live intraday level in Redis. Carries `IngestionRun`
    provenance (lineage, not a per-row marker) → synthetic levels surface "illustrative"
    and are purgeable by run.
- **Computed cap-weighted** (real FBM KLCI methodology) over synthetic constituent bars
  by the ingestion worker: **nightly to Postgres** (the daily series) **plus a live
  level recomputed in the 5-min Redis replay**.
- **Behind an `IndexAdapter` on the source-adapter seam.** Demo = `SyntheticIndexAdapter`
  (cap-weights synthetic constituents, `synthetic`). Production is identical
  entities/endpoints, where the level is **ingested from a licensed feed**
  (`LicensedIndexAdapter`, `real`) or **recomputed cap-weighted over real licensed
  prices** as a branded house index. **Whether FBM KLCI specifically may be shown in
  production is a licensing question deferred to the architecture map's
  vendor-verification task** — the seam makes it a swap, not a rebuild.

### 3. Sector performance — reads the per-`Sector` `IndexLevel`s

Same machinery scoped per `Sector`: each Bursa `Sector` has its own `MarketIndex` row,
so sector performance is a plain read over those `IndexLevel`s (live from Redis during
hours, latest Postgres otherwise), cap-weighted, consistent with the headline index. No
request-time aggregate — the sector indices are first-class rows.

### 4. Cadence + cache-class (ADR-0004)

Through-line: **intraday-live = class 3 (Redis-only); EOD-derived/stored = class 2
(Postgres); nothing is class 1 (AI results).**

| Panel | Market hours (09:00–16:45 MYT) | Outside hours / history |
| --- | --- | --- |
| Movers board | 5-min Redis replay → **class 3** | latest EOD close → **class 2** |
| Index headline (live level) | 5-min Redis replay → **class 3** | latest `IndexLevel` (Postgres) → **class 2** |
| Index / sector history (series) | stored `IndexLevel` series (Postgres) → **class 2** | same |
| Sector performance | live per-`Sector` level (Redis) → **class 3** | latest per-`Sector` `IndexLevel` → **class 2** |

Matches spec 01's cadences exactly (intraday never touches Postgres).

### Endpoints (anonymous)

- `GET /market/movers?type=gainers|losers|actives&limit=` (default 10).
- `GET /market/indices` — headline + sector indices, current level + %change, with
  `provenance`.
- `GET /market/indices/:id/series?range=` — `IndexLevel` history for one index.
- `GET /market/sectors` — sector-performance board (per-`Sector` %change).

### Model additions (additive to spec 01)

`MarketIndex`, `IndexLevel`, `IndexAdapter` (seam method). Glossary terms already
landed in `apps/backend/CONTEXT.md`.

## Testing Decisions

- **Good test = external behaviour** (which stocks/indices a panel returns, ordering,
  provenance, cache class), not computation internals.
- **Movers tests:** gainers/losers/actives ordering over a seeded universe; live vs
  EOD-fallback source selection by market-hours clock.
- **Index computation test:** cap-weighted level over synthetic constituents matches the
  expected weighted sum; per-sector index scopes to its constituents.
- **Cache-class tests:** intraday reads hit Redis only (never Postgres); historical
  series read Postgres.
- **Provenance test:** synthetic index levels tagged `synthetic` → illustrative label.
- **Adapter-swap test:** consumers read `IndexLevel` regardless of which adapter produced
  it (fake `LicensedIndexAdapter`).
- **Integration** via testcontainers Postgres + Redis (ADR-0011).
- Prior art: `apps/backend` controller/integration tests.

## Out of Scope

- **Movers liquidity/market-cap floor** — deliberately not added (option A).
- **Official-index licensing** (may we show "FBM KLCI"?) — architecture map's
  vendor-verification task.
- **Index chart component / overlays** — frontend; only the series *data* endpoint is
  in scope.
- **General instrument OHLC series endpoints** — still fog (charting data); the
  `IndexLevel` series is a precedent for range/interval params when that graduates.
- **Anonymous rate-limit / abuse posture** — cross-cutting open question.

## Further Notes

- No new ADR flagged by this spec (uses spec-01's model + candidate ADR-0012).
- `MarketIndex`/`IndexLevel`/`IndexAdapter` are a genuine addition to spec-01's entity
  set; this spec owns them so the execution effort folds them into the shared model.
