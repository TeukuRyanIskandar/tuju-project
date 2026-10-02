# Build ticket: IndexAdapter seam + nightly cap-weighted computation

Type: task
Status: resolved
Blocked by: 01 (entities + migration)

> Wave 2 of the spec-05 execution effort. Fixed inputs: the ticket-01 entities,
> the spec-01 source-adapter seam (one interface per data class + DI tokens,
> demo impls behind DI — `free-tier-data` ticket 02), the spec-01 worker
> (crons, `IngestionRun`/`SyntheticRun` lineage, ADR-0012), ADR-0004
> (class-2 read cache, key-prefix separation).

## What to build

The index machinery that makes a stored, chartable, provenance-honest index
series exist — verifiable end-to-end by running the worker's nightly ingest
(one-shot command) and reading the levels back:

1. **`IndexAdapter` on the source-adapter seam:** one interface + DI token,
   same shape as the spec-01 adapter classes; demo implementation
   `SyntheticIndexAdapter` (provenance class `synthetic`) cap-weighting the
   synthetic constituent bars using the real FBM KLCI methodology. Production
   is a swap: `LicensedIndexAdapter` ingesting a licensed feed (`real`) or a
   house recompute over real prices — identical entities and consumers either
   way (the seam is the demo/production boundary).
2. **Nightly computation in the worker, ordered after the EOD ingest:** for each
   `MarketIndex` (headline + every sector), compute the cap-weighted level from
   that day's constituent bars and persist one `IndexLevel` per index per day
   with `IngestionRun` lineage. Idempotent on re-ingest (ticket-01 natural keys).
3. **Purge + cache wiring:** synthetic `IndexLevel`s are deleted by the
   decision-B purge (by lineage, like the other synthetic data classes); a
   `cache:market:` prefix joins the read-cache key constants and is swept
   fail-loud by the nightly ingest and the purge, same as the
   search/stocks/disclosures/screener prefixes.

## Acceptance criteria

- [ ] Cap-weighted level over synthetic constituents matches the expected
      weighted sum (test with known bars); the per-sector index scopes to its
      sector's constituents only.
- [ ] Nightly ingest lands one `IndexLevel` per index per day in Postgres,
      ordered after EOD; a second nightly run updates in place (no duplicate
      rows, stable ids).
- [ ] Synthetic levels carry `synthetic` provenance via lineage → surface as
      "illustrative"; the decision-B purge deletes exactly the synthetic
      levels and leaves lineage rows.
- [ ] `cache:market:` prefix exists, swept by nightly + purge (integration-
      pinned, same test shape as the existing prefixes); keys outside the
      prefixes survive.
- [ ] `IndexAdapter` is a seam swap: a fake `LicensedIndexAdapter` producing
      `real` levels feeds identical consumers (adapter-swap test).
- [ ] Worker one-shot command computes + persists indices (demoable without
      waiting for the cron).
- [ ] Integration via testcontainers Postgres (ADR-0011); typecheck + full
      suite green.

## Out of scope (later tickets under this effort)

- Live intraday levels + movers precompute in the 5-min replay (ticket 03).
- All `GET /market/*` endpoints (tickets 04, 05).
- FBM KLCI licensing for production display — architecture map's
  vendor-verification task (spec 05 Out of Scope).
