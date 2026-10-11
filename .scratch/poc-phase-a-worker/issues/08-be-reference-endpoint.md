# Build: Backend reference endpoint + TA event detection

Type: task
Status: done
Blocked by: 07-worker-to-spec

## Scope

Implement `GET /stocks/:code/analysis/reference` and related support for the Python worker to fetch fact packets (TA block + events, FA block) without direct Postgres access (ADR-0004).

### Deliverables

1. **`src/stocks/technical-events.ts`** — Pure function `computeTechnicalEvents(snap: IndicatorSnapshot, latestCloseDay: string, prevBar: PriceBar | null)` computing all 7 `TechnicalEventId`s on-read from stored indicator snapshot + price bars (no re-computation, no new DB calls).

   - Events: `ma_cross_20_50`, `ma_cross_50_200`, `price_vs_sma`, `rsi_band`, `macd_cross`, `week52_proximity`, `broke_swing_high`
   - `broke_swing_high` uses 1-bar lookback: `latestClose > prevBar.close` (fired: false when prevBar null)

2. **`src/stocks/analysis-reference.ts`** — Backend-local interface + assembly function:
   - `AnalysisReferenceResponse` — worker-facing shape (not in `@tuju/contracts`)
   - `toAnalysisReference()` — assembles response from entities + computed events
   - FA metrics: 9 fields from `FundamentalsSnapshot` + `QuarterlyFinancials` rows
   - Per-metric `asOf`: snapshot metrics use `latestCloseDay`; quarterly-derived use `quarters[0].periodEnd`
   - `operating_cash_flow` always null for PoC (OCF ingest is a follow-on)

3. **`StocksService.getAnalysisReference(stockCode)`** — Public method:
   - Gate: `requireKlciInstrument` (404 outside KLCI 30)
   - Load: `IndicatorSnapshot`, `FundamentalsSnapshot`, 2 latest `QuarterlyFinancials`, 2 latest `PriceBar`s, identity fields
   - 404 when no `IndicatorSnapshot` (no data to serve)
   - No class-2 caching (worker needs live data)

4. **`StocksController`** — New route before the catch-all `:code` route:
   ```ts
   @Get(':code/analysis/reference')
   getAnalysisReference(@Param('code') code: string)
   ```
   Update JSDoc to document the new endpoint.

5. **Unit tests** — `src/stocks/technical-events.spec.ts`
   - All 7 events compute correctly with known indicator values
   - RSI overbought (>70) and oversold (<30) fire correctly
   - `week52_proximity` threshold (within 5%)
   - `broke_swing_high` fires when `latestClose > prevBar.close`; `fired: false` when prevBar null
   - Null indicator values produce `fired: false`
   - No new DB queries (pure functions)

### Testing strategy

- Unit: `technical-events.spec.ts` (no Docker, pure computation)
- Integration: add test case to `stocks.int.spec.ts` seed the data + verify reference endpoint returns correct shape matching the contract

### Acceptance criteria

✓ `GET /stocks/:code/analysis/reference` returns valid response for KLCI-30 codes — **VERIFIED** (integration test `stocks.int-spec.ts` line 722)
✓ 404 for unknown codes — **VERIFIED** (line 782)
✓ 404 when `IndicatorSnapshot` not found — **VERIFIED** (line 788)
✓ All 7 TA events compute correctly — **VERIFIED** (line 745–754)
✓ FA metrics include all 9 required fields — **VERIFIED** (line 764–776)
✓ Per-metric `asOf` correctly set (snapshot vs quarterly) — **VERIFIED** (implementation confirmed in `analysis-reference.ts`)
✓ Unit tests pass (pure functions) — **VERIFIED** (14/14 tests pass)
✓ Integration test validates response shape — **VERIFIED** (4/4 reference tests pass, all assertions pass)

### Related

- Consumer: `services/ai` `_handle_technical_job` / `_handle_fundamental_job`
- Spec: `.scratch/poc-phase-a-worker/spec.md` § "Fact assembly: reference read contract"
- ADR-0004 (worker stateless reader), ADR-0012 (TS indicators)
