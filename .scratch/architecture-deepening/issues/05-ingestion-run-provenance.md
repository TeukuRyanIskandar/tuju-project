# Source adapters self-report provenance; Ingestion run module

Status: resolved
Strength: Worth exploring
Dependency category: ports & adapters (fake adapters in-process; Postgres local-substitutable)
Blocked by: 04 (same file: eod-ingest.service.ts)

## Files
- `ingestion/eod-ingest.service.ts` (984 lines; `runNightly` 148–378, `collectFailureSummary`/`readAdapterDividends` 948–983, duplicated materialise loops 279–303 vs 446–463)
- `data/adapters/adapter.interfaces.ts`, `adapters.module.ts`, `demo-adapters.ts`, `yfinance/*`
- `ingestion/ingestion-run.service.ts`

## Problem
`runNightly` branches on `provenanceClass === Real` in 4 places, hardcodes adapter names, and duck-types yfinance-only methods through `unknown`, which depend on a hidden call order. Ingestion run provenance will be wrong after any adapter swap. On the yfinance path, DY no longer uses the single corporate-action dividend source.

## Direction
- Every adapter self-reports `adapterName` and `provenance`, and returns failures (and dividends, where relevant) as data from its fetch.
- An Ingestion run module `run(manager, adapter, persist)` opens the run from the adapter's own name.
- `EodIngestService` becomes an ordered list of steps with no provenance branching.
- The duplicated materialise loop is extracted once.

## Tests
A fake adapter stamps its own name, and the test asserts the IngestionRun row and the failure summary. The ingestion int-spec stays green.

## Comments

**2026-10-12, implemented (uncommitted on `refactor/architecture-deepening`).**

- Adapter seam (`data/adapters/adapter.interfaces.ts`): `SourceAdapter` now self-reports `adapterName` + `provenanceClass` + optional `generation` (`SyntheticGeneration`: seed + params → the run is a `SyntheticRun`). Every fetch returns `SourceFetch<Row>` = `{ rows, failures }` (`fetched(rows)` helper). `FundamentalsAdapter.fetchFundamentals()` returns `FundamentalsFetch` with optional `dividends: DividendDto[]` (new DTO). `MarketDataAdapter` declares `universe: 'reference' | 'klci30'`.
- Adapters: demo + yfinance adapters carry literal names equal to the names the nightly used to hardcode (`SyntheticMarketDataAdapter`, `AggregatorDisclosureAdapter`, `RssNewsAdapter`, `ManualShariahListAdapter`, `ManualIpoAdapter`, `SyntheticIndexAdapter`, `YFinanceMarketDataAdapter`), so lineage stays the same. The synthetic market + fundamentals adapters declare the same `generation` (`SYNTHETIC_BASE_SEED`, `{...DEFAULT_PARAMS, baseSeed}`), which is what `openSyntheticRun` was given before. `SyntheticIndexAdapter` declares none, so it still gets a standard run with synthetic provenance, as before. yfinance adapters keep no state: `getFailureSummary`/`getDividendsByStockCode` are deleted and failures/dividends are returned from the fetch.
- Ingestion run module: `IngestionRunService.run(manager, adapter, land)` opens the run from the adapter's declaration, calls `land(runId)` (→ `{ value, failures }`), and logs `ingestion-run.failure-summary` (correlationId = run id) when there are failures. It returns `{ runId, value, failures }` and refuses a `generation` on a non-synthetic adapter. `openRun` stays for the reference seeders and test fixtures.
- `EodIngestService`: `runNightly` is now an ordered list of steps: reference → `ensureMarketUniverse` → `landEod` (bars + fundamentals in the market adapter's run; throws if fundamentals provenance ≠ market provenance) → disclosures → news → Shariah → IPO → `materialise` → index. After commit: one `changed({ kind: 'eodIngested' })`, the summary enqueue, `afterMarketUniverseIngested` (KLCI TA/FA enqueue for `klci30`). `ingestKlci` reuses `landEod` + `materialise`, so the duplicated snapshot loop exists once. Removed: all 4 `provenanceClass === Real` branches, every hardcoded adapter name, `collectFailureSummary`/`readAdapterDividends` (`unknown` duck-typing), and the hidden fetch-then-read-dividends ordering. `NightlyIngestResult.failures` now collects every step's failures.
- Deviation: the yfinance/KLCI path still differs from the demo path (it upserts the KLCI 30 and enqueues TA/FA afterwards). It now switches on the market adapter's declared `universe`, not on provenance, because the analysed universe is the thing that really varies. A licensed KLCI adapter would declare `klci30` and work with no ingest change. On the yfinance nightly, materialise now runs after disclosures instead of before them. The rows are the same.
- **DY finding (product decision needed; behaviour kept):** yfinance dividends feed DY directly and are never persisted as `CorporateAction` rows. So on the yfinance path, the calendar shows the aggregator's demo dividends while DY uses real vendor dividends. To make it single-source, the yfinance dividends would have to land as `CorporateAction` rows. Then (a) real vendor dividends would show in the corporate-actions calendar (licence/product question), and (b) DY over persisted rows would also count the demo aggregator dividends for the KLCI codes that overlap the reference set. Those demo rows build up nightly, because the now+10d dividend has a new natural key every day, and this would change the numbers a lot. The deviation is now explicit and documented (`FundamentalsFetch.dividends`, CONTEXT DY note) instead of hidden. Fixed in passing: the demo path used to pass every corporate action with an amount (rights too) into DY as dividends. Only `DIVIDEND` actions count now (`dividendCorporateActions`). The demo numbers are unchanged, because those rows' ex-dates fall outside the generator's window, which ends 2025-12-31.
- Tests: new `ingestion/ingestion-run.service.spec.ts`: the run is stamped from a fake adapter's own name/provenance, failures come back as the summary, `generation` → `SyntheticRun`, and the guard. `provenance.spec.ts` pins every demo adapter's `adapterName` (lineage) and which adapters declare `generation`. `klci-ops.int-spec.ts`: the fakes self-report `FakeKlciMarketAdapter` (the old `'YFinanceMarketDataAdapter'` assertion against a fake is gone). A new case checks the IngestionRun row + failure summary for a failing symbol, skip-and-continue lineage, and vendor dividends feeding DY. `yfinance-adapters.spec.ts` asserts failures/dividends as fetch data and the self-reported names. The seam fakes (`adapter-seam.spec.ts`, `indices.int-spec.ts`) were updated to the new shape. `ingestion.int-spec.ts` is unchanged and green.
- Verified: typecheck clean; unit 41/41 suites (428 tests); int 18/18 suites (188 tests). Both lanes include ticket 08's concurrent additions.

