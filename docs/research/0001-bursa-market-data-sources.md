# Bursa Malaysia (KLSE) Market & Fundamental Data Sources — Decision-Grade Comparison

Status: research findings (decision-grade, not a build)
Date: 2026-09-28
Author: research-data-source (agent)
Scope: Product A — one-stop KLSE retail intelligence dashboard. Consuming app is a
NestJS backend ingesting/proxying into Postgres, serving dashboard views (IPO calendar,
stock prices, top-5 movers, watchlists) and feeding a Python AI module (technical +
fundamental analysis).

> **How to read this.** Every factual claim is tagged with a source URL. Where a claim
> could not be pinned to a primary source, it is explicitly flagged **[UNVERIFIED]** or
> **[NEEDS SALES CONFIRMATION]**. Pricing figures move; treat any number as
> "confirm at contract time."

---

## TL;DR recommendation

For a lean, warm-500-user launch the sane posture is a **hybrid, two-vendor + primary-source
model**, and the single most important finding is a *licensing* one, not a coverage one:

1. **Exchange data over KLSE is licensed data.** Bursa Malaysia treats real-time and
   delayed KLSE market data as licensed content that consuming applications must be
   *authorized* to redistribute/display — confirmed by a CME advisory instructing
   downstream consumers of Bursa data to "contact Bursa Malaysia directly to be
   appropriately licensed." (See §1.) This means: **no vendor's cheap "personal" plan
   legally covers a SaaS that displays KLSE data to end users.** You need either
   (a) a vendor's *commercial/redistribution* tier, or (b) a direct Bursa information-vendor
   licence.

2. **Primary vendor: EODHD (EOD Historical Data), on a *commercial* licence.** It is the
   only mainstream vendor with *documented, self-serve* KLSE coverage (exchange code
   `KLSE`, MIC `XKLS`) spanning EOD OHLC, fundamentals, splits/dividends, and a bulk
   whole-exchange endpoint — the right shape for ingesting slow-moving data into Postgres.
   EODHD's published packages are **personal-use only**; a SaaS requires their commercial
   licence (quote-based, ~3 business days to onboard, and they report you as a commercial
   user to the exchange). (§2.1)

3. **Optional real-time proxy: Twelve Data, on a *Pro* tier + Redistribution Rights
   Add-On.** Twelve Data lists Malaysia/`XKLS` on its Pro tier and its WebSocket path is
   the cleaner fit if you later need near-real-time intraday. But its default licence is
   **Internal Use only**, forbids caching "beyond permitted timeframes," forbids external
   display without a **Redistribution Rights Add-On**, and requires deleting all data
   within 30 days of termination — all of which directly shape your DB design. (§2.2)

4. **IPO calendar + prospectus documents are effectively scrape/primary-source, not
   vendor-API.** Vendor IPO calendars (e.g. EODHD's) are US/HK-centric, carry only ~3
   weeks forward visibility, and contain *no prospectus documents*. The authoritative
   Malaysian IPO + electronic-prospectus source is Bursa's own site plus the issuing
   houses (Tricor / Malaysian Issuing House) and aggregators (i3investor, insage). Plan to
   ingest these via a scheduled scraper/manual pipeline, not an API. (§3)

**Launch stack:** EODHD commercial (EOD OHLC + fundamentals + splits/dividends, bulk
ingest nightly into Postgres) → Postgres is your system of record for slow-moving data →
Python AI reads from Postgres. Intraday "prices / top-5 movers" is where the storage
licence bites hardest; for launch, run it on **delayed EOD/last-close** to stay clean, and
only add a real-time proxy (Twelve Data Pro + redistribution add-on, or a direct Bursa
delayed-data licence) once revenue justifies it. IPO/prospectus via a scheduled
scraper against Bursa/issuing-house sources.

---

## 1. Official / direct Bursa Malaysia feeds

**Does Bursa offer an official market-data feed?** Yes. Bursa Malaysia operates a licensed
**information-vendor / market-data licensing** regime (real-time, delayed, and EOD feeds
distributed through authorized data vendors and direct licences), consistent with every
major exchange. This is a *licensed content* model, not an open API.

Key primary-source signals:

- **KLSE data is licensed and downstream consumers must be authorized.** A CME Group
  market-data advisory explicitly told downstream recipients of Bursa Malaysia market data
  that to keep consuming it they "must contact Bursa Malaysia directly to be appropriately
  licensed." This is the clearest public confirmation that displaying/redistributing KLSE
  data is gated by a Bursa licence.
  Source: https://www.cmegroup.com/tools-information/lookups/advisories/market-data/20110914.html
- **Third-party distributors of Bursa derivatives data operate under Bursa vendor
  agreements** (vendor/user definitions, redistribution terms).
  Source (example vendor market-depth agreement): https://www.scribd.com/document/485589770/Market-Depth-1-Meor-pdf
- **Bursa Derivatives rulebook** (governs data/market conduct on the derivatives side;
  evidence of the formal licensing/rules apparatus around Bursa data).
  Source: https://www.cftc.gov/sites/default/files/idc/groups/public/@otherif/documents/ifdocs/bmdbursamalaysiaderivativesbe.pdf
- **Institutional redistributors carry Bursa Malaysia in their licensed catalogs** (i.e.
  it is available as a licensed feed to those who sign): ICE Consolidated Feed lists Bursa
  Malaysia. Source: https://developer.ice.com/fixed-income-data-services/catalog/bursa-malaysia

**Access terms / cost tiers / storage rights:** Bursa's public market-data pages are
**not machine-fetchable from here** — `www.bursamalaysia.com/.../information_services`
returned **HTTP 403** to automated retrieval, so specific fee schedules and the exact
redistribution/storage clauses of a *direct* Bursa licence could **not be captured from
primary source in this session**. **[NEEDS DIRECT CONFIRMATION — contact Bursa
Market Data / Information Services]**. What is established: it is a paid, contract-based
licence; redistribution/display to end users is a licensed act; professional-vs-retail
user classification and reporting obligations apply (mirrored by every vendor below).

**Consumer apps (Bursa Anywhere / Bursa Marketplace):** these are Bursa's own end-user
products, not developer data feeds. `bursamarketplace.com` was under maintenance at fetch
time. They are not a data-source option for us.
Source: https://www.bursamarketplace.com/

> **Design implication:** a *direct* Bursa licence is the "purest" option but is heavier
> (contract, fees, professional-user reporting, likely feed-handler integration) than a
> lean 500-user launch warrants. Prefer a vendor who has already licensed KLSE and can
> sub-license display rights to us via a commercial/redistribution tier.

---

## 2. Third-party vendor APIs covering KLSE

### Coverage summary

| Vendor | KLSE covered? | Tier where KLSE lives | Real-time / delayed / EOD | Fundamentals | Storage/display licence | Verdict |
|---|---|---|---|---|---|---|
| **EODHD** | **Yes (documented)** — code `KLSE`, MIC `XKLS` | Any paid plan (adds non-US exchanges) | EOD + delayed; RT via VWAP/OTC aggregation, not exchange feed | **Yes** (stocks/ETFs/funds fundamentals, splits/dividends) | Published plans **personal only**; SaaS needs **commercial licence** (quote) | **Primary ingest vendor** |
| **Twelve Data** | **Yes (documented)** — Malaysia / `XKLS` | **Pro** (and Venture) | Malaysia shown with **no delay label** (others tagged "EOD delay"/"20 min") → treat as RT-capable on Pro; **confirm** | Yes (fundamentals product) | **Internal Use** default; **Redistribution Rights Add-On** required to display to end users; **cache limits apply**; delete data ≤30 days post-termination | **Real-time proxy option** |
| **Financial Modeling Prep** | **[UNVERIFIED]** — global claims, KLSE not confirmed in primary docs | — | — | Yes (US-strong) | — | Verify symbols before relying |
| **Alpha Vantage** | **Weak / [UNVERIFIED]** — "limited Malaysia coverage" reported | — | — | Normalized, no filing traceability | — | Not for KLSE core |
| **Marketstack** | **[UNVERIFIED]** for KLSE (70+ exchanges, US/EU-centric) | — | RT/EOD | Limited | — | Verify before use |
| **Finnhub** | **No free intl.** — non-US RT now paid/partnership only | Paid only | — | — | — | Not lean-friendly |
| **Polygon / Tiingo** | **No** — US-centric, no KLSE | — | — | — | — | Out of scope |
| **RapidAPI / Apify KLSE scrapers** | **Yes (scraped)** | pay-per-record | Screener/fundamentals/announcements | Yes (scraped) | You inherit *their* scraping ToS risk | Fallback only |

Sources for the table:
- EODHD KLSE code/MIC and per-exchange coverage model:
  https://eodhd.com/financial-apis/exchanges-api-list-of-tickers-and-trading-hours
- EODHD data sourcing (VWAP over 100+ OTC/P2P sources; **not** exchange feeds for pricing;
  direct exchange contracts for EOD/delayed on 60+ exchanges):
  https://eodhd.com/financial-apis/our-data-sources-and-data-partners
  and disclaimer text on https://eodhd.com/commercial-pricing
- Twelve Data Malaysia/`XKLS` on Pro tier (coverage matrix) and live XKLS quotes:
  https://twelvedata.com/stocks and exchange page https://twelvedata.com/exchanges/xkls
- Finnhub dropped free non-US real-time:
  https://help.bindtuning.com/en/articles/344526
- Alpha Vantage "limited Malaysia coverage" and US-centric:
  https://www.quora.com/where-can-i-get-the-malaysia-stock-market-data
- Apify KLSE fundamentals / screener scrapers (community-maintained):
  https://apify.com/lewxiangang/klse-fundamentals and
  https://apify.com/nexgendata/bursa-malaysia-stock-screener

### 2.1 EODHD — the primary ingest candidate (details)

**Coverage.** KLSE is a first-class supported exchange: exchange code `KLSE`, operating MIC
`XKLS`; the platform exposes it through the same EOD, Fundamental, Splits/Dividends,
Search, Bulk, and Exchange-Symbol-List endpoints used for every other market. The
Exchange-Symbol-List endpoint returns the full active (and separately, delisted) ticker
universe for a given exchange in one call (cost: 1 API call) — ideal for building your
instrument table.
Source: https://eodhd.com/financial-apis/exchanges-api-list-of-tickers-and-trading-hours

**Nature of the pricing data (important caveat).** EODHD states it does **not** use
exchange feeds for pricing; prices are aggregated via VWAP over 100+ OTC/peer-to-peer/
trading-platform sources, while EOD and delayed data come via direct exchange contracts on
60+ exchanges. So EODHD "real-time" is indicative, not an exchange-grade tick feed — fine
for a retail dashboard and AI features, **not** for anything execution-grade.
Source: https://eodhd.com/financial-apis/our-data-sources-and-data-partners

**Rate limits (per account, plan-independent structure):**
- **1,000 requests / minute** (counts requests, not cost). 429 + `Retry-After` on exceed.
  Response headers `X-RateLimit-Limit` / `X-RateLimit-Remaining` expose live budget.
- **Daily API-call budget:** Free = 20 calls/day (unusable for prod); **paid plans start
  at 100,000 calls/day**, raisable.
- **Endpoint costs (calls):** EOD / Splits-Dividends / Search / Exchange-list / Calendar =
  **1**; Intraday / Technical / News / Screener = **5**; **Fundamentals = 10**; Bulk
  whole-exchange = **100** (`100 + N` when using the `symbols` param). Multi-symbol
  requests multiply cost. Failed/404 lookups still charge.
Source: https://eodhd.com/financial-apis/api-limits

**Ingestion-design consequence (EODHD):** for ~900–1,000 KLSE names, a nightly refresh is
comfortably within 100k calls/day:
- 1× Bulk EOD for the whole exchange = **100 calls** (vs ~1,000 calls doing it per-symbol).
- Fundamentals refreshed on a slow cadence (they change quarterly): 1,000 names × 10 =
  10,000 calls if done in one sweep — so **stagger fundamentals across the month**
  (e.g. ~35 names/day) rather than refreshing all nightly.
- Splits/dividends via Bulk or per-symbol at 1 call each.

**Licensing / storage / redistribution (the gating issue):** EODHD's **published pricing
packages are for personal use only**. Commercial use (a SaaS displaying data to end users
is commercial) requires their **separate commercial licence**: quote-based, onboarding "in
as little as 3 business days," and — critically — **EODHD reports all commercial users of
exchange data to the relevant exchanges** to satisfy its contracts with those exchanges,
and classifies professional vs private (retail) users following exchange rules.
Source: https://eodhd.com/financial-apis/commercial-vs-personal-license-use

> Net: with an EODHD **commercial** licence you can build the intended product (persist in
> Postgres, cache, display to your users), but the specific storage/display permissions and
> whether Bursa attribution or professional-user fees attach **must be confirmed in the
> commercial quote**. **[NEEDS SALES CONFIRMATION: exact storage/redistribution clause +
> whether KLSE display incurs Bursa pro-user fees.]**

**Pricing (published, personal tiers — indicative only):** entry paid tier advertised
around **US$19.99/mo (≈US$16.58/mo annual)**; commercial pricing is quote-based.
Source: https://eodhd.com/pricing and https://eodhd.com/commercial-pricing

### 2.2 Twelve Data — the real-time proxy candidate (details)

**Coverage.** Malaysia is listed under the **Pro** tier (also Venture), keyed to `XKLS`.
On Twelve Data's coverage matrix most non-US markets are tagged "EOD delay" or "20 min
delay"; **Malaysia carries no delay tag**, which on their matrix indicates real-time-capable
coverage on Pro — **but confirm the exact latency for XKLS with sales before relying on it
for a live "movers" board.** Free tier = 800 requests/day (US real-time only).
Source: https://twelvedata.com/stocks (coverage matrix) and https://twelvedata.com/exchanges/xkls

**Licensing / storage / redistribution (from the Terms of Use, "Last updated Jan 1 2026"):**
- **Default licence is Internal Use**: you may "access, receive, process, and **store** Data
  solely for Internal Use," display only to Authorized Users, and create Derived Data that
  cannot be reverse-engineered back to the source. (§2.2)
- **External display / redistribution to *your end users* requires a Redistribution Rights
  Add-On or a separate written agreement.** A public SaaS dashboard = external display →
  **add-on required.** (§2.2(b),(e), §2.4, §18.2)
- **Caching is time-boxed:** the Restrictions forbid "store or cache Data beyond permitted
  timeframes specified in the Documentation." So a persistent Postgres cache of Twelve Data
  content is only clean **within their documented retention window** — **[NEEDS DOC/SALES
  CONFIRMATION of the exact permitted cache duration for XKLS].** (§2.3(g))
- **Free-tier data may not be used commercially.** (§2.3(l))
- **Third-party/exchange data may carry extra agreements, exchange fees, professional-
  subscriber rates, and reporting** — you are solely responsible for compliance, and the
  exchange is a third-party beneficiary that can enforce. (§3)
- **On termination you must delete all Data within 30 days.** (§16.2)
- Governing law: Singapore; SIAC arbitration. (§14.1–14.2)
Source: https://twelvedata.com/terms

> **Design implication (Twelve Data):** you cannot treat Twelve Data as your permanent
> historical store. Use it as a **proxy + short-TTL cache** for fast-moving intraday
> (prices, movers), keep the TTL inside their documented window, and buy the Redistribution
> Rights Add-On before showing it to users. This is a heavier ongoing constraint than
> EODHD's commercial licence, which is why EODHD is preferred for the *stored/persisted*
> slow-moving data and Twelve Data (if used) is scoped narrowly to the live layer.

---

## 3. IPO calendar & prospectus data (KLSE-specific)

**Where it comes from.** For Malaysia the authoritative chain is:
- **Securities Commission Malaysia (SC)** approves listings and registers prospectuses.
- **Bursa Malaysia** (Bursa Securities) hosts the electronic prospectus and IPO listing
  info on `www.bursamalaysia.com`.
- **Issuing houses** — chiefly **Tricor Investor & Issuing House Services** and **Malaysian
  Issuing House (MIH)** — distribute the electronic prospectus and application details.
- **Aggregators** re-host the same PDFs: **i3investor** (`cdn1.i3investor.com/.../ipo/...`)
  and **insage** (`insage.com.my/BursaNews/...`).

Evidence (prospectus PDFs all reference the Bursa website as the official electronic-
prospectus location, and name the issuing houses):
- https://www.insage.com.my/BursaNews/Attachment/202401/20240112/HEGROUP-AN20240112A2-1.pdf
- https://cdn1.i3investor.com/my/files/st88k/0392_KEEMING/ipo/2026/0392_KEEMING_IPO_IPOP_KeeMingGroupBerhadProspectusPart1_-1380424560.pdf
- https://www.insage.com.my/BursaNews/Attachment/202511/20251120/GENERGY-AN20251120A2-1.pdf

**Is it API-accessible?** **No usable vendor IPO API for Malaysia at prospectus depth.**
EODHD *does* have an IPO calendar endpoint, but:
- Its examples/coverage are **US/HK-centric**, forward visibility is only **~3 weeks**, and
  it carries **only listing metadata** (name, exchange, price range, offer price, shares,
  deal_type) — **no prospectus document, no Malaysian-specific fields**.
Source: https://eodhd.com/financial-apis/calendar-upcoming-earnings-ipos-and-splits

**Conclusion for §3:** IPO calendar + prospectus is **scrape / scheduled-ingest** territory.
Build a small pipeline that polls Bursa's IPO listing page + issuing-house/aggregator PDF
locations, stores the calendar rows in Postgres, and stores/links prospectus PDFs (then the
Python module can parse them for the "prospectus analysis" feature). Prospectuses are
public documents intended for prospective investors, which is favorable for ingestion, but
respect the Malaysian jurisdictional disclaimers they carry (they are "not authorised for
distribution outside Malaysia").

---

## 4. Scraping Bursa's public site — viability & risk

**Technical viability:** partial. Bursa's own site actively blocks automated retrieval
(**HTTP 403** on direct fetch of the market-information page in this session), so naive
scraping of `bursamalaysia.com` is fragile and likely to be rate-limited/blocked. Prospectus
PDFs are more accessible via issuing-house/aggregator CDNs (i3investor, insage), which are
easier to fetch but are **third parties**, not Bursa.

**Legal / ToS risk:**
- **Live price/quote data is the highest-risk thing to scrape.** Because KLSE market data is
  licensed (§1), scraping and *redistributing* real-time/delayed quotes from Bursa's site to
  your users likely breaches Bursa's terms and its data-licensing regime — the same regime
  that requires vendors to report commercial users. Do **not** scrape live quotes as a
  production source.
- **Reference/corporate data (company lists, announcements, IPO calendar, prospectus PDFs)**
  is lower-risk: it is public disclosure material. Still governed by site ToS; scrape
  politely (rate-limit, identify, cache), and prefer official/issuing-house sources.
- **Third-party scraper APIs (Apify/RapidAPI KLSE actors)** shift the maintenance burden but
  **not** the licensing risk — you inherit whatever rights (or lack thereof) that actor has,
  and community actors carry no redistribution warranty.
Sources: 403 behavior observed at
https://www.bursamalaysia.com/trade/trading_resources/market_information/information_services
; scraper actors at https://apify.com/nexgendata/bursa-malaysia-stock-screener

**Posture:** scraping is acceptable as a **fallback for slow-moving reference/IPO/prospectus
data**, never as the primary source for **priced market data**. Fragility (layout changes,
blocking) makes it a maintenance liability; isolate scrapers behind an adapter interface so
a vendor can replace them later.

---

## 5. Recommended posture for a hybrid, warm-500-user launch

**Architecture (maps to the NestJS + Postgres + Python plan):**

- **System of record = Postgres**, populated by scheduled ingest jobs. This is licensed to
  hold **EODHD commercial** data (EOD OHLC, fundamentals, splits/dividends) and
  **self-sourced** reference/IPO/prospectus data.
- **Slow-moving data (ingest nightly/periodic into Postgres):**
  - Instrument universe: EODHD Exchange-Symbol-List (`KLSE`) — 1 call, refresh weekly.
  - Daily OHLC: EODHD **Bulk EOD** for the whole exchange — **100 calls/night**.
  - Fundamentals: EODHD Fundamentals, **staggered ~35 names/day** (10 calls each) to stay
    well under budget and because fundamentals only change quarterly.
  - Splits/dividends: EODHD, cheap (1 call).
  - IPO calendar + prospectus PDFs: scheduled scraper against Bursa/issuing-house/aggregator
    sources; store rows + PDF links/blobs for the Python prospectus-analysis feature.
- **Fast-moving data (proxy + short-TTL cache, do NOT persist long-term):**
  - "Stock price" tiles / "top-5 movers": **for launch, serve from EOD/last-close** stored in
    Postgres to stay unambiguously within licence. This is the cheapest and cleanest path.
  - **Only if a live intraday board is a launch requirement:** add **Twelve Data Pro +
    Redistribution Rights Add-On**, used as a *proxy* with a cache TTL kept **inside their
    documented retention window**, never as a permanent store. Alternatively pursue a
    **direct Bursa delayed-data licence** if the numbers favor it at scale.
- **Python AI module** reads exclusively from Postgres (technical indicators over stored
  OHLC; fundamental ratios over stored fundamentals; prospectus NLP over stored PDFs). It
  never calls vendors directly — keeps rate-limit and licence surface in one place.

**Why EODHD as the anchor:** it is the only self-serve vendor with documented KLSE coverage
across *both* prices and fundamentals, a bulk endpoint sized for whole-exchange nightly
ingest, and a commercial licence that (subject to quote confirmation) permits the persist-
and-display model the product needs. Twelve Data is the better *real-time* engine but its
Internal-Use default + time-boxed caching + mandatory redistribution add-on make it a poor
fit for a *stored* system of record — so it is scoped to the live layer only, and deferred.

### Constraints that must shape ingestion design (the "gotchas")

1. **Licence, not coverage, is the blocker.** Budget for **EODHD commercial** (quote) from
   day one; the free/personal tiers cannot legally back a public dashboard. Confirm whether
   KLSE display triggers Bursa professional-user fees. **[NEEDS SALES CONFIRMATION]**
2. **EODHD cost math:** whole-exchange EOD via **Bulk = 100 calls**; **Fundamentals = 10
   calls/symbol** → stagger. 1,000 req/min ceiling; honor `Retry-After`/`X-RateLimit-*`.
   Failed lookups still cost — validate symbols against the exchange list first.
3. **Twelve Data (if adopted):** **cannot be your historical store** — caching is limited to
   their documented window, external display needs the **Redistribution Rights Add-On**, and
   **all data must be deleted within 30 days of termination**. Design the intraday cache as
   ephemeral (Redis/short-TTL), not as a Postgres table you keep.
4. **Real-time is indicative, not exchange-grade** (EODHD VWAP aggregation; Twelve Data
   latency for XKLS unconfirmed). Fine for retail/AI, unsuitable for execution — label it as
   such in-product.
5. **IPO/prospectus is scrape-maintained** — isolate behind an adapter; expect breakage;
   respect Malaysian jurisdictional disclaimers on prospectuses.
6. **Direct Bursa licence is the clean-but-heavy alternative** for the live layer at scale;
   revisit once >500 users or when a real-time board becomes core.

---

## Open items / to verify before contracting

- [ ] **Bursa Information Services**: fee schedule + exact storage/redistribution and
      professional-user terms of a direct licence (page blocks automated fetch; contact
      Bursa Market Data directly).
- [ ] **EODHD commercial quote**: confirm persist-in-Postgres + display-to-users rights for
      **KLSE specifically**, and any Bursa attribution / pro-user fee pass-through.
- [ ] **Twelve Data**: confirm (a) XKLS real-time latency, (b) exact permitted cache
      duration in the Documentation, (c) Redistribution Rights Add-On price for a
      B2C dashboard.
- [ ] **FMP / Marketstack**: verify actual KLSE symbol coverage (`.KL`/`XKLS`) via a live
      symbol probe before considering as a backup — current primary docs do not confirm it.

## Sources (primary)

- Bursa data is licensed (CME advisory): https://www.cmegroup.com/tools-information/lookups/advisories/market-data/20110914.html
- Bursa Derivatives rulebook (CFTC copy): https://www.cftc.gov/sites/default/files/idc/groups/public/@otherif/documents/ifdocs/bmdbursamalaysiaderivativesbe.pdf
- ICE catalog lists Bursa Malaysia: https://developer.ice.com/fixed-income-data-services/catalog/bursa-malaysia
- EODHD supported exchanges / KLSE code + XKLS MIC: https://eodhd.com/financial-apis/exchanges-api-list-of-tickers-and-trading-hours
- EODHD data sourcing (VWAP, not exchange feeds for pricing): https://eodhd.com/financial-apis/our-data-sources-and-data-partners
- EODHD API limits / call costs: https://eodhd.com/financial-apis/api-limits
- EODHD commercial vs personal licence: https://eodhd.com/financial-apis/commercial-vs-personal-license-use
- EODHD IPO/calendar endpoint (US/HK-centric, ~3wk, no prospectus): https://eodhd.com/financial-apis/calendar-upcoming-earnings-ipos-and-splits
- EODHD pricing (personal): https://eodhd.com/pricing ; commercial: https://eodhd.com/commercial-pricing
- Twelve Data coverage matrix (Malaysia on Pro): https://twelvedata.com/stocks
- Twelve Data XKLS exchange page: https://twelvedata.com/exchanges/xkls
- Twelve Data Terms of Use (Internal Use, redistribution add-on, cache limits, 30-day delete): https://twelvedata.com/terms
- Finnhub non-US real-time now paid/partnership: https://help.bindtuning.com/en/articles/344526
- Malaysian prospectus examples (Bursa as official e-prospectus host; issuing houses): https://www.insage.com.my/BursaNews/Attachment/202401/20240112/HEGROUP-AN20240112A2-1.pdf ; https://cdn1.i3investor.com/my/files/st88k/0392_KEEMING/ipo/2026/0392_KEEMING_IPO_IPOP_KeeMingGroupBerhadProspectusPart1_-1380424560.pdf
- Apify KLSE scrapers (fallback): https://apify.com/lewxiangang/klse-fundamentals ; https://apify.com/nexgendata/bursa-malaysia-stock-screener
