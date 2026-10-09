# Decide: TA fact engine defaults

Type: grilling
Status: resolved
Blocked by: 01

## Question

Pitch Feedback TA examples: “broke previous high”, “MA cross just happened”,
“RSI looking healthy”. Defaults named: RSI, MACD, MA crosses, 52-wk high. Users
may define their own indicators later.

Pin the **PoC fact set**: which indicators, which structured events, where they
are computed, and what stays deferred.

## Answer

**Fixed PoC indicator/event set, computed from stored daily OHLCV; structured
events only (no advice).**

### Indicators (values always present when enough history)

| Indicator | Params | Notes |
| --- | --- | --- |
| SMA | 20, 50, 200 | Close-based |
| RSI | 14 | 0–100 |
| MACD | 12, 26, 9 | Line, signal, histogram |
| 52-week high / low | 252 trading days | From stored bars |

Same definition family as ADR-0012 / free-tier `IndicatorSnapshot` where overlapping;
PoC may extend the snapshot or compute event detection in the worker from bars —
**BE/worker specs choose the seam**, but numbers must match a single formula module.

### Structured events (boolean + levels; drive the card)

1. **MA cross:** SMA-20×SMA-50 and SMA-50×SMA-200 — golden/death cross detected on
   the latest bar vs previous bar; include both MA values and cross date.
2. **Price vs MA:** close above/below SMA-50 and SMA-200 (state, not signal).
3. **RSI band:** latest RSI; flags `oversold` (<30), `neutral` (30–70),
   `overbought` (>70) as **descriptive bands only** (copy must not say buy/sell).
4. **MACD cross:** MACD line vs signal on latest vs prior bar; include values.
5. **52-week proximity:** % below 52-w high / above 52-w low; flag if close is
   within 2% of 52-w high (or at new 52-w high).
6. **Broke prior swing high:** prior swing = max high of the previous 20 sessions
   excluding today; flag if today’s high exceeds it (Pitch Feedback “broke
   previous high”).

Each event: `{ id, labelKey, fired: bool, values: {...}, at: ISO date }`.

### Timeframe

- PoC: **daily (`1D`)** only. `1W` / `1M` remain in the payload enum but are not
  precomputed for the demo.

### Deferred

- User-defined indicator sets / AAA teaching presets (Naim input later).
- Intraday TA.
- Chart overlay series beyond what ticket 07 needs for the price chart (indicator
  overlays optional in FE spec).

### Unblocks

- [03 — artifact contract](03-descriptive-artifact-contract.md) (TA half of facts)
