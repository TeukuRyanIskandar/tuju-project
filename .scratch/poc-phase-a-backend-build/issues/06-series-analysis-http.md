# Build ticket: series + analysis + artifact routes

Type: task
Status: resolved
Blocked by: 01, 04

> Execution of handoff § series + analysis read routes (planning ticket 06).
> Wave 3. Contracts Zod already in `@tuju/contracts` `http/stocks.ts`.

## Scope (this ticket only)

Extend **`StocksController`** (anonymous):

| Method | Path | Contract |
| --- | --- | --- |
| GET | `/stocks/:code/series?interval=1d&range=2y` | `StockSeriesResponse` |
| GET | `/stocks/:code/analysis/technical` | `StockTechnicalAnalysisResponse` |
| GET | `/stocks/:code/analysis/fundamental` | `StockFundamentalAnalysisResponse` |
| GET | `/stocks/:code/analysis/technical/artifact` | proxied rich JSON, **`cost` stripped** |
| GET | `/stocks/:code/analysis/fundamental/artifact` | proxied rich JSON, **`cost` stripped** |

- Outside KLCI 30 or unknown code → **404** (`isKlci30`).
- Series: ~2y EOD bars; empty `points` allowed (200); `demoLabel:
  'private-demo'`; other interval/range → 400.
- Analysis no row → 200 `status: 'pending'` null fields; with row → map store.
- Read-time **stale** promotion when `as_of` behind latest EOD close day.
- `artifactPath` only when pointer exists.
- Artifact proxy: S3 get + omit `cost` (do not copy IPO prior art blindly).

## Out of scope

- FE card layout / chart library.
- Enqueue from browser.
- Re-shaping HTTP Zod.

## Testing seam

- Int/unit: 404 outside 30; series shape; pending without row; cost stripped
  on artifact; stale promotion.

## Acceptance

- Routes live; contracts validated in tests; hard-gate + cost strip verified.

## Answer

All five routes live on `StocksController` (specific paths declared before the
generic `:code` route), anonymous, no `@RequiresJob`.

- **Hard-gate:** `requireKlciInstrument` — `isKlci30` check + instrument
  resolve, else `NotFoundException`. Seeded-but-outside-30 (INARI 0200) and
  unknown codes both 404; verified in `stocks.int.spec.ts`.
- **Series** (`getSeries`): rejects non-`1d`/`2y` query with
  `BadRequestException` (absent params default to the PoC literals); ~730
  calendar-day window anchored to the series' OWN latest bar
  (`seriesSinceDate`, market index posture — not the wall clock); empty
  `points: []` → 200 with instrument-run provenance; bars path provenance =
  the latest `PriceBar`'s ingestion run; `demoLabel: 'private-demo'`.
- **Thin reads:** no row → 200 `status: 'pending'` + null fields (correct
  `jobName` literal); row → store fields mapped via
  `to{Technical,Fundamental}AnalysisResponse`; `artifact`/`artifactPath` only
  when bucket+key pointer exists (`/stocks/{code}/analysis/{kind}/artifact`).
- **Read-time stale:** `promoteAnalysisStatus` promotes `ready`/`facts_only`
  to `stale` when the `as_of` calendar date is behind the instrument's latest
  EOD close day; never written back; `pending`/`running`/`failed` untouched.
- **Artifact proxy:** mirrors `IpoService.getArtifact` (S3 `GetObjectCommand`
  on the Nest-persisted pointer) then **omits `cost`** (`omitArtifactCost`)
  before returning JSON — the deliberate divergence from IPO prior art.
  404 on non-30 / no row / no pointer / empty body.
- **Mapping helpers** live in `apps/backend/src/stocks/stock-analysis-read.ts`
  (pure functions: query validation, stale promotion, cost strip, thin
  mapping, pending envelopes); `stocks.types.ts` re-exports the new contract
  types (type-only, ADR-0014 CommonJS guard).
- **Module wiring:** `StocksModule` now imports `S3Module` (claim-check
  fetch); no `AnalysisModule` import — thin reads go through the `DataSource`
  repositories directly (same pattern as the rest of `StocksService`).
- **Tests:** unit pins in `stocks.spec.ts` (query validation, stale
  promotion, cost strip); integration in `stocks.int.spec.ts` (series shape +
  `parseOrThrow` contracts, empty points, 400s, hard-gate 404s, pending
  envelopes, ready→stale + artifactPath, cost-stripped proxy via fake S3,
  FA artifact 404 without pointer). Full backend suite green (46 suites /
  486 tests; `test:int` lane 5/5).
- **Drive-by fix (pre-existing ticket-05 break):** `EodIngestService`'s new
  `KlciEnqueueService` constructor dep wasn't provided in three older
  harnesses (`ingestion.int.spec.ts`, `klci-ops.spec.ts`,
  `indices.int.spec.ts` runNightlyIngest) — added a no-op stub provider in
  each (the follow-on only fires when yfinance/`Real` is bound, which none of
  those harnesses use); their behaviour is unchanged.
