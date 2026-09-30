# Decide: demo data posture (which sources feed the prototype, and how)

Type: grilling
Status: resolved
Blocked by: 01, 02, 03

## Question

For the private partner/investor demo, **which source feeds each data class** (reference data, EOD prices, delayed intraday, indices, fundamentals, announcements/corporate events, IPOs, Shariah list, news), and for each: **live scheduled pull, one-time captured fixture, or scraper**?

Also decide:
- The **licence boundary**: what must change (sources swapped, data purged) before anything is shown publicly.
- How the choice stays swappable for the production vendor (EODHD commercial per ADR-0004): i.e. the source-adapter seam's contract at the level of "what each adapter must provide", not its code.
- Whether any data class is **dropped from the demo** because no acceptable source exists.


## Answer

**Posture: synthetic-but-labelled prices, real public reference/disclosure data, everything behind a source-adapter seam.** No self-serve vendor tier legally permits showing real KLSE prices to outside partners/investors, and paying for a permitting licence (EODHD Custom from US$399/mo + agreement, or Enterprise US$2,499/mo; Twelve Data Business + Redistribution Add-On, quote-based) is not justified for a pre-revenue private demo. The pitch showcases the analysis/AI engine, not price accuracy, so illustrative prices carry it. Real prices become a later adapter swap (ticket 06 keeps chasing the quote in the background; if written demo permission arrives cheaply it can swap in, but nothing blocks on it).

### Per-data-class source & mode

| Data class | Source | Mode | Licence risk |
| --- | --- | --- | --- |
| Reference data (code, short/full name, sector, board, listing status) | Bursa public listings | Real, scheduled/manual ingest | Low (public) |
| EOD OHLCV (charts) | Generated per-ticker series (e.g. GBM/bootstrapped returns), seeded per ticker, calibrated to plausible ranges | **Synthetic**, labelled "illustrative" | None |
| Delayed intraday (movers board) | Synthetic replay over the synthetic EOD series | **Synthetic**, labelled | None |
| Index levels (FBM KLCI, sector) | Synthetic, derived from the synthetic constituent series | **Synthetic**, labelled | None |
| Fundamentals (statements + derived ratios) | Generated **alongside** the synthetic prices so all price-derived ratios (P/E, market cap, DY, P/NTA, PSR) reconcile — decision **A1** | **Synthetic**, internally consistent | None |
| Announcements / corporate events (entitlements, quarterly-results dates, substantial-shareholder/director dealings) | Aggregator snapshot (i3investor / KLSE Screener), respecting crawl-delay | **One-time captured fixture / snapshot** (unlicensed → demo-only) | Medium — purge before public |
| News | Google News / FMT Business / Malay Mail Money RSS | Live scheduled pull, **headline + link only**, ticker-tagged by us | Low |
| Shariah list | SC SAC PDF (May + Nov) | **Manual** twice-yearly ingest, show "as at" | Low (public) |
| IPO calendar + prospectus | Curated **manual** entry + stored prospectus PDFs | Manual | Low |

### Decision A1 — fundamentals are fully synthetic and internally consistent

Because prices are synthetic, **everything price-derived must be synthetic too**. Fundamentals are generated together with the price series so a partner who hand-computes P/E, market cap, dividend yield or P/NTA gets the number the screener shows. Real public statements are **not** mixed with synthetic prices for the demo — real-earnings-over-fake-price produces an authoritative-looking nonsense ratio, the misleading trap the research flagged. Real fundamentals only re-enter once real prices do (the same adapter swap). This also lets the whole screener + ratio-derivation path (research 03) run unchanged on demo data.

### Decision B — licence boundary before anything goes public

- **Synthetic data may stay** at public launch — either relabelled or swapped to a licensed real-price adapter.
- **Aggregator-sourced announcements / corporate events MUST be purged and re-sourced from a licensed Bursa feed** (the Bursa Information Services enquiry, architecture ticket 10) before any public exposure. They are demo-snapshot only.
- **News stays headline + link only**, never full text, in demo and in public.
- Everything shown in the private partner/investor demo carries a visible **"illustrative data"** label on price/fundamental figures.

### Source-adapter seam contract (what stays swappable)

One interface per data class; each adapter must provide the same shape regardless of whether it's a demo or production source:

- `MarketDataAdapter` — reference data, EOD OHLCV, delayed snapshot, index levels. Demo impl = `SyntheticMarketDataAdapter`; production impl = `EodhdMarketDataAdapter`.
- `FundamentalsAdapter` — statements + the fields ratio-derivation needs. Demo = synthetic (co-generated with prices); production = EODHD.
- `DisclosureAdapter` — announcements, entitlements, results dates, dealings. Demo = aggregator-snapshot; production = licensed Bursa feed.
- `NewsAdapter` — headline + link + timestamp + source. Demo and production both RSS-shaped.
- `ShariahListAdapter` — ticker → compliant flag + "as at" date. Demo and production both SC-PDF-sourced.
- `IpoAdapter` — IPO calendar entries + prospectus pointer. Manual both.

Swapping demo → production means implementing the production adapter behind the same interface; no consumer (screener, stock page, movers board) changes.

### Dropped classes

**None.** Every data class in scope has an acceptable demo source. Live/real-time exchange prices were never in scope for the free tier (ADR-0004 defers the live intraday layer; end-of-day baseline + delayed intraday is the target, and both are synthetic here).

### Hands forward (graduates fog / feeds later tickets)

- Confirms **ticket 06** (licence quotes) stays **non-blocking** and background-only.
- Sharpens the **free-tier domain model** fog: entity set is now concrete (instrument, price bar, fundamentals snapshot/quarterly financials, derived ratios, indicator snapshot, announcement, corporate action, news article, Shariah status, IPO, watchlist) with synthetic co-generation as a modelling constraint.
- Feeds **ticket 07** (ingestion pipeline shape) — now unblocked — with the concrete adapter list, the synthetic co-generation requirement (prices + fundamentals from one seeded generator), and the per-class cadences.
