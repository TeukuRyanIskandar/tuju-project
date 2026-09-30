# Research: screener fields and indicator computation for KLSE

Type: research
Status: resolved
Blocked by: (none)

## Question

What can a **basic KLSE screener** filter on, given realistic data sources, and how should technical indicators be produced for the later charting / technical-filter extension?

Cover:
- **Fundamental fields actually available for KLSE** (not just US): P/E, P/B, dividend yield, ROE, market cap, revenue/earnings growth, debt/equity, per candidate source (EODHD, FMP, Yahoo, scraped KLSE Screener / i3investor). Flag fields that are missing or stale for Malaysian stocks, and which we can **derive ourselves** from price + statements.
- **Vendor screener APIs** (e.g. EODHD Screener, FMP stock screener): do they support KLSE, and is calling them better than filtering our own Postgres data (per ADR-0004 we'd normally store and query ourselves)?
- **Reference screeners** for scope: what filters KLSE Screener, i3investor, TradingView (Malaysia), and Bursa Marketplace offer. That gives the "basic" baseline users expect.
- **Technical indicators:** options for computing RSI/MA/MACD etc.: vendor technical endpoints vs. computing at ingest (Python `pandas-ta`/`ta-lib`, or TS libraries) vs. SQL. Note licence/maintenance status of each library.

Fixed input: [docs/research/0001-bursa-market-data-sources.md](../../../docs/research/0001-bursa-market-data-sources.md).

Feeds: [Decide: demo data posture](04-demo-data-posture.md); later the screener spec.


## Answer

Findings: `docs/research/0004-screener-and-indicator-data.md` on branch `research/screener-indicators` (commit `d218fdf`).

- **Baseline = KLSE Screener's filter set** (read live from its form): board, sector/subsector, Shariah, price, volume, market cap, P/E, EPS, DY, NTA, P/TBV, PSR, ROE, D/E, debt/cash, profitable-years, QoQ/YoY/consecutive growth, RSI, stochastic, gainers/losers.
- **Filter our own Postgres; don't proxy a vendor screener.** EODHD Screener has only 14 fields (no P/E/ROE/NTA/growth/Shariah), a 1,000-match cap, and admitted patchy fundamentals on smaller venues.
- **Derive ratios in-house** from stored price + quarterly financials + dividends (P/E TTM, DY, P/NTA, PSR, ROE, D/E, growth). This keeps definitions consistent and lets the synthetic-data demo work unchanged.
- **Indicators: TA-Lib in the Python worker** as a system-triggered job; NestJS persists snapshots/series; the screener stays SQL. `pandas-ta` upstream is gone (GitHub 404; last release a 2025 beta), and `pandas-ta-classic` is the active fork. TS option if ever needed: `trading-signals`. Avoid vendor technical endpoints.
- **Basic demo screener:** board, sector, Shariah, price, volume, market cap, P/E, DY, P/NTA, ROE, D/E, profitable-years, YoY profit growth, sort by % change. **Extension:** RSI, SMA-50/200, 52-wk hi/lo, stochastic, consecutive growth.
- Hands forward: sector taxonomy (Bursa vs vendor), ratio definitions, indicators-as-job vs SQL for the demo.
