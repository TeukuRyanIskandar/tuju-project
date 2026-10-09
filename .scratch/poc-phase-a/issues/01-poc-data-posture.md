# Decide: PoC data posture — yfinance KLCI 30

Type: grilling
Status: resolved
Blocked by: (none)

## Question

Pitch Feedback locks PoC on **yfinance** (`.KL`) and **FBM KLCI 30**. The free-tier
map locked **synthetic-but-labelled** prices because no cheap vendor licence allows
showing real KLSE prices to outside partners.

For this PoC effort, decide:

1. Do we adopt yfinance for the PoC path anyway (private demo), and how does that
   sit beside the synthetic free-tier pipeline?
2. Universe: exact KLCI 30 membership — how is the list sourced/maintained?
3. Which data classes come from yfinance vs existing free-tier sources?
4. Licence boundary before any public exposure.

## Notes

- Obsidian [[Data Sources]]: yfinance OHLCV + fundamentals tested live; rate
  limits (429); Yahoo ToS = **no commercial/public use** without permission.
- Free-tier [demo-data-posture](../../free-tier/issues/04-demo-data-posture.md)
  decision A1 (co-generate fundamentals with synthetic prices) must not be blindly
  applied when both prices and fundamentals are real.
- User lock: Pitch Feedback literally + real data if possible.

## Answer

**Adopt yfinance for the PoC path only, behind the existing source-adapter seam,
KLCI 30 universe, private/demo labelled.**

### 1. Relationship to free-tier synthetic

- **Demo-script supersession:** the venture-builder PoC walks the yfinance KLCI 30
  path. Synthetic free-tier pages/prospectus are **not** the demo script.
- **Code coexistence:** keep the synthetic pipeline; add a `YFinanceMarketDataAdapter`
  (name pinned in BE spec) selectable by ingest config / provenance class `real`.
  No requirement to delete synthetic data in this effort.
- **A1 does not apply** on the PoC path: prices and fundamentals are both real from
  the same vendor surface, so ratios are computed from real inputs (same ratio
  formulas as spec 01 where they still apply).

### 2. Universe

- **Analysed PoC universe = current FBM KLCI 30 ordinary shares** (Main board).
- Membership is a **curated seed list** (stock codes + `.KL` Yahoo suffixes) checked
  into the repo / config; refreshed manually when index composition changes (BE
  spec owns the file format). PoC does not scrape index constituents live.
- Search / stock page for the PoC demo only need to work for these 30; other
  instruments may exist in DB from free-tier seed but are out of demo script.

### 3. Per-class source (PoC path)

| Data class | Source | Mode |
| --- | --- | --- |
| Reference (code, name) | Curated KLCI 30 seed (+ Bursa public names as needed) | Manual / seed |
| EOD OHLCV | yfinance `.KL` | Scheduled pull, **cached**, throttled |
| Fundamentals / ratios inputs | yfinance `.info` + quarterly financials | Scheduled pull, cached |
| Indicators | Derived in-house from stored EOD (ADR-0012 TS path) | Nightly after price ingest |
| News | Prefer existing RSS + ticker tag; yfinance `.news` optional supplement | Degrade if empty |
| Intraday / movers board | **Out of PoC demo script** (free-tier synthetic may remain unused) | — |
| IPO / prospectus | **Out of PoC demo script** | — |

### 4. Licence boundary

- Visible UI/API provenance: **`real` + “private demo — non-redistributable”** (not
  the free-tier “illustrative/synthetic” label).
- **Before any public launch:** purge or stop serving yfinance-sourced rows;
  swap adapter to licensed EODHD/Bursa (architecture vendor task). Same spirit as
  free-tier decision B, stricter: yfinance is demo-only forever without Yahoo
  written permission.
- Cache everything; batch pulls; respect 429s — operator cost is reliability, not
  licence fees, for PoC.

### Unblocks

- [02 — system-precompute trigger](02-system-precompute-trigger.md)
- [04 — TA fact defaults](04-ta-fact-defaults.md)
- [05 — FA fact + news](05-fa-fact-and-news.md)
