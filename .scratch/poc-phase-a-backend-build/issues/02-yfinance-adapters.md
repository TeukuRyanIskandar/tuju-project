# Build ticket: yahoo-finance2 adapters + DATA_SOURCE DI

Type: task
Status: resolved
Blocked by: 01

> Execution of handoff § yfinance adapter binding (planning ticket 02).
> Wave 1. Depends on `klci30-universe` for the Yahoo symbol map.

## Scope (this ticket only)

- Add dep `yahoo-finance2` to `apps/backend`.
- Implement:
  - `YFinanceMarketDataAdapter` → `MARKET_DATA_ADAPTER` — daily OHLCV →
    `PriceBarDto[]` for the KLCI 30 (`stockCode` from universe; Yahoo via
    `yahooSymbol`).
  - `YFinanceFundamentalsAdapter` → `FUNDAMENTALS_ADAPTER` — `.info` +
    quarterly financials (+ dividends/actions needed for DY materialiser) →
    `FundamentalsDto[]`.
- `provenanceClass = real`.
- Wire `AdaptersModule` with env **`DATA_SOURCE`**:
  - `synthetic` (default) → existing synthetic adapters.
  - `yfinance` → the two new classes.
  - News / disclosure / Shariah / IPO / index tokens unchanged (news stays
    `RssNewsAdapter`).
- Redis vendor cache prefix `vendor:yfinance:…` — **outside**
  `READ_CACHE_PREFIXES` ingest sweep.
- In-process throttle + 429/5xx backoff.
- Partial failure: **skip + continue** per symbol; ops-visible summary if any
  failed.
- Document in `.env.example`.

## Out of scope

- `seed-klci` / `ingest-klci` commands (ticket 03).
- Changing nightly cron wiring beyond making adapters injectable (ticket 03
  owns `openSyntheticRun` → real-run when yfinance bound).
- Indicator derivation (already ADR-0012 post-ingest).

## Testing seam

- Unit with mocked `yahoo-finance2` client: maps bars/fundamentals DTOs;
  skip+continue on one bad symbol; cache hit avoids second fetch.
- DI factory resolves synthetic vs yfinance from env in a small module test.

## Acceptance

- `DATA_SOURCE=yfinance` binds both adapters; default remains synthetic;
  tests green; no live Yahoo in CI.

## Answer

- Dep: `yahoo-finance2@^4` in `apps/backend`; `DATA_SOURCE` on `AppConfig` +
  `.env.example` (default `synthetic`).
- Adapters under `apps/backend/src/data/adapters/yfinance/`:
  `YFinanceMarketDataAdapter` / `YFinanceFundamentalsAdapter`
  (`provenanceClass = real`), vendor Redis cache `vendor:yfinance:…`,
  in-process throttle + 429/5xx backoff, skip+continue + failure summary.
  Dividends cached under vendor prefix for ticket 03 DY wiring (not on
  `FundamentalsDto`).
- `AdaptersModule` factory swaps market/fundamentals only; news stays RSS.
- Tests: `yfinance-adapters.spec.ts` (mocked client), `data-source-di.spec.ts`;
  typecheck clean; no live Yahoo in CI.
