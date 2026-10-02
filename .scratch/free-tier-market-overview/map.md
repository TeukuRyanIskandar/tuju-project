# free-tier-market-overview — execution effort (spec 05 implementation)

Breaking [spec 05 — market overview](../free-tier-specs/05-market-overview.md) into
build tickets. Backend only. Ticket work lands in `apps/backend`.

Fixed inputs (do not re-decide): ADR-0001–0012 (esp. ADR-0004 3-class Redis cache,
ADR-0012 dedicated worker), the spec-01 entities/migrations/worker/adapter seam
(all resolved in `free-tier-data`), and the spec-05 decisions (whole-universe
movers option A, cap-weighted `IndexLevel`s behind an `IndexAdapter`, intraday
never touches Postgres).

## Ticket status

| # | Ticket | Wave | Blocked by | Status |
| - | ------ | ---- | ---------- | ------ |
| 01 | [MarketIndex / IndexLevel entities + migration](issues/01-market-index-and-index-level-entities.md) | 1 | — | resolved |
| 02 | [IndexAdapter seam + nightly cap-weighted computation](issues/02-index-adapter-seam-and-nightly-computation.md) | 2 | 01 | resolved |
| 03 | [Intraday live levels + movers precompute in the 5-min replay](issues/03-intraday-live-levels-and-movers-precompute.md) | 3 | 02 | ready-for-agent |
| 04 | [Movers endpoint (`GET /market/movers`)](issues/04-movers-endpoint.md) | 4 | 03 | ready-for-agent |
| 05 | [Index + sector endpoints (`/market/indices`, `/market/sectors`)](issues/05-index-and-sector-endpoints.md) | 4 | 03 | ready-for-agent |

## Wave structure

- **Wave 1:** ticket 01 — the additive model (`MarketIndex`/`IndexLevel`) only:
  entities + migration, no behaviour. Sized alone so the schema change is
  reviewable in isolation (the `free-tier-data` ticket-01 precedent).
- **Wave 2:** ticket 02 — the `IndexAdapter` on the source-adapter seam, the
  `SyntheticIndexAdapter` (cap-weighted, real FBM KLCI methodology), nightly
  computation to Postgres in the worker with `IngestionRun` provenance, and the
  `cache:market:` class-2 prefix + sweep wiring.
- **Wave 3:** ticket 03 — extends the worker's 5-min Redis-only intraday replay
  with live index/sector levels and the precomputed movers boards (class 3,
  never Postgres).
- **Wave 4 (parallel):** ticket 04 (movers endpoint) ∥ ticket 05 (index +
  sector endpoints) — fresh-context sub-agents in their own files, then
  `app.module.ts` wiring + full verification by the orchestrator (the
  screener-effort pattern). Both read the wave-2/3 stores; no file overlap.

## Decisions / notes so far

- Spec 05 is the authority; this map only sequences it. Open spec questions
  (movers floor, official-index licensing, charting/OHLC, anonymous rate
  limits) stay out of scope per the spec's Out-of-Scope section.
- Movers precompute (03) is worker-side; the endpoint (04) is a pure read —
  the spec's "intraday stays Redis-only, never Postgres" rule depends on this
  split.
- The `IndexLevel` series `range` param is the deliberate precedent for the
  still-foggy general OHLC series endpoints (spec 05 Further Notes).
- Ticket 01 resolved: `MarketIndex`/`IndexLevel` entities + migration
  (`1728000000-MarketIndexModel.ts`) landed additively with unit +
  testcontainers tests (up/down, upsert idempotency, purge-by-lineage). Key
  shape choices: `(kind, sector_id)` natural key `NULLS NOT DISTINCT` (headline
  row included), `(index_id, level_date)` level natural key, both run FKs
  RESTRICT, and `MarketIndex → Sector` RESTRICT per the Company→Sector
  precedent (review catch — CASCADE would wipe chartable history).
- Ticket 02 resolved: `IndexAdapter` (one interface + `INDEX_ADAPTER` token on
  the spec-01 seam) + `SyntheticIndexAdapter` (pure cap-weighted computation,
  FBM KLCI divisor methodology — Σ close × shares normalised to a 100-point
  base at the series' earliest date; free-float adjustment omitted, no float
  data in the demo) + nightly persist ordered after the indicators, own
  `IngestionRun` per nightly (7 runs total), and `cache:market:` swept via the
  new shared `ReadCacheService.invalidateReadCaches()` over
  `READ_CACHE_PREFIXES` (code-review fix — the per-prefix cascade had
  duplicated across ingest + purge). Decisions from the review: the purge
  deletes `MarketIndex` rows too (they're sourced rows with synthetic
  lineage; a `real` licensed index survives), display names carry no
  "(illustrative)" wording (the label is a read-time lineage join, never a
  stored string), and `data.module.ts`'s migration list caught up with
  `data-source.ts` (the DisclosureReadModel gap closed as a side effect of the
  must-stay-in-sync invariant). Idempotency now also pins stable row ids.
