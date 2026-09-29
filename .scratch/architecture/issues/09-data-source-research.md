# Research: market & fundamental data sources for Bursa Malaysia (KLSE)

Type: research
Status: resolved
Blocked by: (none)

## Question

For Product A's data layer, surface a decision-grade comparison of market/fundamental data sources for Bursa Malaysia equities. Feeds sub-question 2 of the data-layer decision (ticket 05): ingest vs. proxy, and what the storage/rate-limit/licensing terms force on the ingestion design. Also informs IPO/prospectus data sourcing.

## Answer

Findings file: [docs/research/0001-bursa-market-data-sources.md](../../../docs/research/0001-bursa-market-data-sources.md)

**Headline (licensing, not coverage):** KLSE market data is *licensed content*. A CME market-data advisory instructs downstream consumers of Bursa data to be appropriately licensed by Bursa Malaysia directly. Consequence: **no vendor's cheap "personal" tier legally backs a SaaS that displays KLSE data to end users** — we need a vendor commercial/redistribution tier or a direct Bursa information-vendor licence.

**Recommended posture — hybrid, two-vendor + primary-source:**

- **Anchor = EODHD on a commercial licence.** Only mainstream vendor with documented self-serve KLSE coverage (code `KLSE`, MIC `XKLS`) across both prices and fundamentals, plus a bulk whole-exchange endpoint sized for nightly ingest. Published plans are personal-use only; SaaS requires their commercial licence (quote-based, ~3 business days; they report commercial users to the exchange).
- **Real-time proxy (DEFERRED) = Twelve Data Pro + Redistribution Rights Add-On.** Lists Malaysia/XKLS on Pro tier. Licence is internal-use by default, forbids caching beyond permitted timeframes, requires a redistribution add-on to display to end users, and mandates deleting all data within 30 days of termination — **cannot be our historical store.** Scope to an ephemeral short-TTL live layer only.
- **IPO calendar + prospectus = scrape / scheduled-ingest, NOT vendor API.** Vendor IPO calendars are US/HK-centric and carry no prospectus docs. Authoritative Malaysian source is Bursa's site + issuing houses (Tricor, Malaysian Issuing House) + aggregators (i3investor, insage).
- **Scraping:** acceptable ONLY for slow-moving reference/IPO/prospectus data; NEVER for priced market data (licensing + Bursa returns HTTP 403 to bots). Isolate behind an adapter.

**Key storage / rate-limit constraints shaping ingestion design:**

1. Budget for **EODHD commercial from day one**; personal/free tiers are not legal for a public dashboard.
2. EODHD: 1,000 req/min ceiling; paid ~100,000 calls/day. Whole-exchange EOD via **bulk = 100 calls** (vs ~1,000 per-symbol); fundamentals = 10 calls/symbol → **stagger** (~35 names/day; fundamentals change quarterly). Failed lookups still charge.
3. Twelve Data **cannot persist long-term** — cache within their window, add redistribution add-on, delete within 30 days on termination. Redis/short-TTL, not a kept Postgres table.
4. "Real-time" from these vendors is **indicative** (EODHD = VWAP over 100+ sources, not exchange feed) — fine for retail/AI, unsuitable for execution — **label in-product.**
5. For a lean 500-user launch, serve price tiles / top-5 movers from **stored EOD / last-close** to stay unambiguously within licence; add live intraday only when revenue justifies it.

**Rejected for KLSE core:** Alpha Vantage (weak MY), Finnhub (no free non-US RT), Polygon/Tiingo (US-only). FMP/Marketstack KLSE coverage **unverified** — probe symbols before using as backup.

**Open items to verify before contracting (become TASK tickets, not decisions):** Bursa Information Services fee/storage terms; EODHD commercial quote (confirm persist+display for KLSE + any Bursa pro-user fees); Twelve Data XKLS latency + cache window + add-on price; FMP/Marketstack live-symbol probe.
