# Research: Bursa public-disclosure, Shariah-list and news sources

Type: research
Status: resolved
Blocked by: (none)

## Question

Where can we get **company announcements, corporate events, IPOs, the Shariah list, and news** for KLSE, and how (API, RSS, scrape), with what ToS/licence posture for a private demo?

Cover:
- **Announcements:** Bursa company-announcement pages (URL/listing structure, filters, per-announcement detail + attachments, any RSS/JSON behind the page, anti-bot behaviour), mirrors (i3investor, insage, KLSE Screener, The Edge). Announcement categories Bursa uses.
- **Derived corporate events** from announcements: entitlements (dividends, ex/payment dates, bonus, rights, splits), **quarterly results** (report dates), **substantial-shareholder and director dealings**. Are these structured fields on Bursa or only free-text/PDF? Also vendor coverage (e.g. EODHD dividends/splits for KLSE).
- **IPO calendar + prospectus:** deepen §3 of the existing research: Bursa listing-IPO pages, SC, Malaysian Issuing House / Tricor; what fields are structured.
- **Shariah-compliant list:** Securities Commission list (publication cadence, format: PDF/Excel, URL stability).
- **News:** KLSE-relevant news sources (EODHD news API KLSE coverage, The Edge / The Star / NST RSS, Bernama, Google News RSS) and licence posture for showing headlines + links (not full text).

Fixed input: [docs/research/0001-bursa-market-data-sources.md](../../../docs/research/0001-bursa-market-data-sources.md) §3–4.

Feeds: [Decide: demo data posture](04-demo-data-posture.md).


## Answer

Findings: `docs/research/0003-disclosure-and-news-sources.md` on branch `research/disclosure-news` (commit `a6b4abd`).

- **Bursa direct is unavailable:** `bursamalaysia.com` (announcements, JSON API, IPO page, even robots.txt), `disclosure.bursamalaysia.com` and insage all return **403**. Circumventing that isn't advisable.
- **Aggregators reachable:** i3investor (`Crawl-delay: 5`) and KLSE Screener (`Crawl-delay: 20`) return 200. i3investor has **structured entitlement pages** (ex/entitlement/payment dates, amount) plus results, insider and meeting sections. But its T&C **grants no licence**, and a data-quality slip was observed. OK for a demo snapshot; not a production posture.
- **Production needs a licensed disclosure feed**, so the Bursa Information Services enquiry (architecture ticket 10) should include company announcements.
- **Shariah list:** SC SAC PDF, **May + November**, 653/914 compliant (71%). Manual twice-yearly ingest; always show "as at". Exact URL UNVERIFIED.
- **News:** Google News RSS, FMT Business and Malay Mail Money RSS work. Edge/Star RSS failed. Use **headline + link only**, with ticker tagging done by us. EODHD News is pre-tagged but inherits ticket 01's licence limit.
- **IPOs:** curated manual entry + stored prospectus PDFs (low volume).
- Every disclosure class sits behind a **source adapter** (demo adapters → licensed adapters later).
