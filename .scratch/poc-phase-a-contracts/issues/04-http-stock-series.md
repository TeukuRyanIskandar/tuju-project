# Decide: HTTP schema for GET /stocks/:code/series

Type: grilling
Status: resolved
Blocked by: (none)

## Question

Parent graduates chart fog for PoC: anonymous EOD series (~2y) on the stock
screen. Index series already exists (`IndexSeriesResponse` in
`packages/contracts/src/http/market.ts`) but is **index levels**, not OHLC bars.

Pin the **HTTP Zod** (not codegen) for stock series:

1. Path + query params (`interval`, `range` / fixed `2y`)?
2. Point shape: OHLC vs close+volume vs both?
3. Numeric representation: string NUMERIC (index style) vs number?
4. Provenance / private-demo labelling on the response?
5. File placement: extend `http/stocks.ts` vs new module?

Fixed inputs: parent ticket 07; ADR-0014 (HTTP Zod, no `modelOrder`).

## Notes

- Reuse `provenanceShape` / `ProvenanceClass` from `http/common.ts` where it fits.
- PoC universe is KLCI 30; schema should still key by `code` like `StockCorePayload`.

## Answer

**New HTTP Zod in `packages/contracts/src/http/stocks.ts` (not codegen): PoC-fixed
`interval: '1d'` + `range: '2y'`, daily OHLC + volume as string NUMERIC like index
series, `provenance: 'real'`, plus a response-level private-demo label.**

### Placement

- Extend [`packages/contracts/src/http/stocks.ts`](../../../packages/contracts/src/http/stocks.ts).
- Do **not** put these schemas in `modelOrder` / Python codegen (ADR-0014).

### Path + query

- Path: `GET /stocks/:code/series` (`code` = Bursa stock code string, same as
  `StockCorePayload.identity.stockCode`).
- Query (echoed on the response):
  - `interval`: literal `1d` for PoC (only daily EOD is graduated).
  - `range`: literal `2y` for PoC — **do not** reuse `IndexSeriesRange` enum
    (`1m`…`all`). A wider stock-series range enum is deferred; PoC pins `2y`
    only so FE cannot request unsupported windows.

### Point shape

Each point is one EOD bar:

```
{ date, open, high, low, close, volume }
```

- `date`: `IsoDate` (`YYYY-MM-DD`)
- `open` / `high` / `low` / `close`: **string NUMERIC** (Postgres NUMERIC /
  index-series style; preserve scale — do not use JS number)
- `volume`: string NUMERIC **or** non-negative number — **pin string NUMERIC**
  for consistency with OHLC strings on this endpoint (volume can be large;
  string avoids float surprises). Handoff: all bar fields that are quantities
  are strings.

No adjusted-close field in PoC; raw EOD as ingested. Indicator overlay series
deferred (parent ticket 07).

### Response envelope

`StockSeriesResponse` (name pinned):

- `code`: string (echo path param)
- `interval`: `'1d'`
- `range`: `'2y'`
- `points`: array of bar points (may be empty if no bars yet — honest empty)
- `provenance`: `ProvenanceClass` — PoC yfinance path is **`real`**
- `demoLabel`: literal or fixed string for UI chip — pin
  **`private-demo`** (FE copies / maps to “private demo — non-redistributable”
  copy; contracts carries the machine label, not the long English sentence)

Reuse `provenanceShape` for the `provenance` field; `demoLabel` is additive on
the response root (not per-point) so one chip covers the whole series.

### Deliberately deferred

- Intraday intervals, adjusted vs raw, range enums beyond `2y`, indicator
  overlay endpoints.

### Unblocks

- FE chart against a typed series response
- Ticket 06 handoff API table row for series
