# Decide: yfinance adapter binding

Type: grilling
Status: resolved
Blocked by: 01

## Question

Parent: EOD OHLCV + fundamental inputs from **yfinance `.KL`**, behind the
existing source-adapter seam, **cached and throttled**, provenance `real` +
private-demo label. Synthetic free-tier adapters stay in the repo.

Pin the **adapter binding**:

1. New `YFinanceMarketDataAdapter` / `YFinanceFundamentalsAdapter` (or one
   combined adapter) vs extending demo adapters?
2. How does DI / config select PoC path vs synthetic (env flag, provenance
   class, separate worker command)?
3. Cache keys + throttle posture (Redis class, rate limits, 429 backoff)?
4. What yfinance surfaces map to existing DTOs (bars, quarterly financials,
   shares, dividends / corporate actions needed for DY)?
5. What happens on partial failure for one of the 30?

Fixed inputs: parent ticket 01; ADR-0004 adapter seam; free-tier
`apps/backend/src/data/adapters/`. A1 co-generation does **not** apply.

## Notes

- Indicators stay TS/in-house from stored bars (ADR-0012) — not from yfinance
  indicator endpoints.
- News prefers existing RSS/tagging; yfinance `.news` optional (ticket 02 does
  not own news unless we decide it does).

## Answer

**Two new yfinance adapters; env-flag DI swap; Redis vendor cache + in-process
throttle; bars + info + quarterly + dividends; skip-and-continue on per-symbol
failure; news stays RSS.**

### 1. Adapter classes

- `YFinanceMarketDataAdapter` → `MARKET_DATA_ADAPTER` (`fetchDailyBars`).
- `YFinanceFundamentalsAdapter` → `FUNDAMENTALS_ADAPTER` (`fetchFundamentals`).
- Both `provenanceClass = real` (private-demo label is a **read/UI** concern on
  top of real rows — same spirit as parent ticket 01).
- Do **not** extend `Synthetic*` classes. Synthetic impls remain for
  `DATA_SOURCE=synthetic` (name pinned below; exact env key may be
  `TUJU_DATA_SOURCE` / `DATA_SOURCE` in build — one flag).

### 2. Runtime selection

- **Env flag swaps DI** in `AdaptersModule` (or a tiny factory): one process
  binds either synthetic or yfinance for market + fundamentals tokens.
- PoC demo machine runs with yfinance bound. Free-tier local demo can keep
  synthetic.
- Index / disclosure / IPO / shariah tokens unchanged unless a later ticket
  says otherwise. **News stays `RssNewsAdapter`** (no yfinance `.news` in this
  map).

### 3. Cache + throttle

- **Redis vendor cache** for raw/normalized Yahoo payloads under a dedicated
  prefix (e.g. `vendor:yfinance:…`) — **not** part of `READ_CACHE_PREFIXES`
  ingest sweep.
- **In-process throttle** + **429/5xx backoff** before/around Yahoo HTTP.
- Exact TTL / QPS numbers are build defaults (document in handoff; tune in
  impl) — posture is mandatory, constants are not sacred.

### 4. Surfaces → DTOs

| Surface | Adapter | Maps toward |
| --- | --- | --- |
| Daily OHLCV history (`.KL`) | Market | `PriceBarDto[]` for KLCI 30 only |
| `.info` (shares, etc.) | Fundamentals | fields inside `FundamentalsDto` |
| Quarterly financials | Fundamentals | quarterly timeline on `FundamentalsDto` |
| Dividends / actions needed for DY | Fundamentals (and/or disclosure CA path if build finds a cleaner fit — prefer fundamentals/vendor pull for PoC DY inputs) | DY inputs; no requirement to replace Bursa disclosure adapter |

- Universe for fetches = `klci30-universe.ts` (ticket 01 / 01a).
- Indicators: still derived in-house post-ingest (ADR-0012).

### 5. Partial failure

- **Skip + continue** the batch for that stockCode; log clearly.
- Command / run ends with a **failure summary** (non-zero exit or equivalent
  ops-visible signal if any symbol failed) so overnight gaps are noticed.
- Bounded retries may be used inside the adapter before skip (impl detail);
  policy is continue-the-30, not abort-all.

### Explicitly out

- yfinance `.news` / replacing RSS.
- Deleting synthetic adapters.
- Live KLCI constituent discovery.

### Unblocks

- Ticket 03 (ingest cadence over these adapters).
