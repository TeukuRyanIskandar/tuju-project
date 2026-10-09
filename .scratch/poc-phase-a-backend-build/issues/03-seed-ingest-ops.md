# Build ticket: seed-klci / ingest-klci + nightly path

Type: task
Status: resolved
Blocked by: 01, 02

> Execution of handoff § ingest + ops cadence (planning ticket 03).
> Wave 2.

## Scope (this ticket only)

| Command | Role |
| --- | --- |
| `seed-klci` | Upsert Sector / Company / Instrument (+ aliases) from `klci30-universe.ts` |
| `ingest-klci` | Bars → fundamentals → materialise snapshots / indicators for the 30 |

- Register both in `worker-main.ts` (mirror `seed-prospectus` pattern).
- Idempotency: **upsert on natural keys** (improve on reference-data
  skip-if-exists so PR membership updates refresh names/aliases).
- Open an `IngestionRun` with lineage matching adapter `provenanceClass`
  (`real` when yfinance bound).
- When `DATA_SOURCE=yfinance`, existing nightly EOD cron exercises the same
  pull/materialise path for the KLCI 30 (fix hardcoded
  `openSyntheticRun` for that path).
- Ops-visible failure summary if any symbol failed during ingest.

## Out of scope

- `enqueue-klci` (ticket 05).
- Analysis tables (ticket 04).
- HTTP routes (ticket 06).

## Testing seam

- Unit/int: seed upserts 30 instruments; re-run is idempotent; ingest with
  fake adapters writes bars + snapshots for a subset.
- worker-main switch arms documented / lightly tested if prior art does.

## Acceptance

- CLI path `seed-klci` then `ingest-klci` works against local infra with
  yfinance bound (manual smoke OK); automated tests green without live Yahoo.

## Answer

- **`KlciSeedService`** (`klci-seed.service.ts`): `seed-klci` upserts Sector /
  Company / Instrument (+ aliases) from `KLCI30_UNIVERSE` on natural keys
  (`Sector.name`, `Instrument.stockCode`); re-run refreshes names/aliases.
- **`EodIngestService.ingestKlci`**: bars → fundamentals → materialise
  snapshots/indicators for the 30; opens `IngestionRun` matching adapter
  `provenanceClass` (`real` / `YFinanceMarketDataAdapter` when yfinance);
  logs ops-visible failure summary; uses yfinance dividend cache for DY.
- **`worker-main.ts`**: `seed-klci` / `ingest-klci` arms (mirror prospectus).
- **Nightly**: when market `provenanceClass === real`, same
  `pullAndMaterialiseKlci` path (no hardcoded `openSyntheticRun`); synthetic
  nightly unchanged.
- **Tests**: `klci-ops.spec.ts` (seed 30 + idempotent; fake-adapter ingest
  subset) green without live Yahoo.
