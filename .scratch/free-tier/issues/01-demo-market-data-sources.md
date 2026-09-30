# Research: KLSE market data sources for a private demo prototype

Type: research
Status: resolved
Blocked by: (none)

## Question

Which sources can feed a **private demo** (partners, early investors; not public) with KLSE market data, and what does each licence allow for that use?

Cover, per source: coverage for KLSE (`.KL` / `KLSE` / `XKLS`), data available, free/personal-tier limits (calls/day, history depth), and **whether the personal/free terms permit showing the data to partners and investors in a private demo** (and whether persisting it in our Postgres is allowed).

Data needed:
- **Symbol universe / reference data:** stock code, short name (e.g. `MAYBANK`), full name, sector, board (Main/ACE/LEAP), listing status.
- **EOD OHLCV** with history depth (for charts).
- **Delayed intraday** (15-min or similar): latency, interval granularity, whether it can back a top-gainers/losers/most-active board.
- **Index levels** (FBM KLCI, sector indices).
- **Fundamentals** (ratios and statements) for KLSE depth and quality.

Candidates: EODHD (personal plan), FMP free, Twelve Data free/basic, Yahoo Finance (unofficial / `yfinance`), Alpha Vantage, Investing.com / i3investor / KLSE Screener (scraping), Bursa's own site. Also note captured-fixture viability (take a snapshot once, replay it).

Fixed inputs: [docs/research/0001-bursa-market-data-sources.md](../../../docs/research/0001-bursa-market-data-sources.md) and the [vendor verification task](../../architecture/issues/10-data-vendor-verification.md). Build on them; don't redo them.

Feeds: [Decide: demo data posture](04-demo-data-posture.md).


## Answer

Findings: `docs/research/0002-demo-market-data-sources.md` on branch `research/demo-market-data` (commit `494ffe3`).

- **No self-serve tier permits showing real KLSE market data to partners/investors, even privately.** EODHD personal/free prohibits "displaying, or granting access" and acting for a business. EODHD Commercial Internal-use (US$399/mo) is explicitly "inside your company" only. Twelve Data Individual plans are personal/internal/non-commercial. `yfinance` is "personal use only". FMP terms were 403 to automated fetch (UNVERIFIED).
- **Outside display** needs EODHD Enterprise (US$2,499/mo) or Custom (from US$399/mo + agreement), or a Twelve Data Business plan + redistribution add-on, or **written demo permission** from a vendor (HITL).
- **Captured fixtures inherit the vendor licence**, so they aren't a loophole.
- **Clean paths:** (a) negotiate demo permission; (b) **synthetic prices on real Bursa reference data**, labelled "illustrative"; (c) hybrid with real public-disclosure data (ticket 02).
- **EODHD covers everything the free tier needs once licensed:** delayed live snapshot 15–20 min (movers board), intraday 5m/1h since Oct 2020 finalised post-close (charts), EOD 30+ yrs, fundamentals, indices, news, screener. **Internal-use tier excludes Bulk API**, so the nightly refresh is ~1,000 calls instead of 100 (fine under 100k/day).
- Even ongoing internal dev on a personal key is technically outside EODHD terms. The free key is fine for a one-off shape probe only.
