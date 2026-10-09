# Decide: one-screen product surface

Type: grilling
Status: resolved
Blocked by: 03, 05

## Question

Pitch Feedback PoC UI: **one screen per stock** — price chart + TA card + FA card
+ news. Frontend today is still a placeholder at
`apps/frontend/src/routes/stocks.$code.tsx`. Free-tier map left **charting / OHLC
series** as fog.

Graduate enough product/API surface for the **overarching** spec (not pixel
DESIGN.md). What blocks, endpoints, and empty states must exist?

## Answer

**Anonymous `/stocks/:code` one-screen for KLCI 30: header, EOD chart series, TA
card, FA card, news. Chart fog graduated for PoC daily series only.**

### Screen blocks

1. **Header** — code, short/full name, last close, % change (EOD), provenance chip
   (`real` / private-demo).
2. **Chart** — daily OHLC (or close line + volume) for ~2 years of stored bars.
3. **TA card** — structured events/facts + BM narrative from latest
   `analyze-technical` system result; `asOf` + stale hint.
4. **FA card** — metrics table + BM narrative from latest `analyze-fundamental`
   system result; `asOf` + stale hint.
5. **News** — headline + source + link list (may be empty).

No accounts, alerts, IPO panel, screener, or market overview required on the
**demo script** path (those may exist in the app shell but are not walked).

### Navigation

- Entry: search or simple KLCI 30 picker limited to the PoC universe.
- Deep link: `/stocks/:code` with Bursa code (e.g. `1155`).

### API surface sketch (overarching; BE spec pins schemas)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/stocks/:code` | Identity + latest fundamentals/technicals snapshots (reuse/extend free-tier) |
| GET | `/stocks/:code/series?interval=1d&range=2y` | **New for PoC** — EOD OHLC series |
| GET | `/stocks/:code/analysis/technical` | Latest system TA summary + artifact pointer/body |
| GET | `/stocks/:code/analysis/fundamental` | Latest system FA summary + artifact pointer/body |
| GET | `/stocks/:code/news` or existing news scoped route | Headline+link list |

All anonymous for PoC. Analysis reads are cache class 1; series/core class 2.

### States

| State | UX |
| --- | --- |
| Series loading / ready | Chart skeleton then data |
| Analysis pending (never run) | Card: “Belum dijana — jalankan precompute” / empty |
| Analysis running | Card: progress phase labels if polled; else “Sedang dijana” |
| Analysis ready | Facts + narrative |
| Narrative stripped (grounding fail) | Facts only + note |
| Analysis failed terminal | Error message; facts absent |
| Stale (`asOf` < last EOD ingest) | Show data + “bukan penutup terkini” chip |
| News empty | “Tiada berita” — not an error |

### Deliberately not in overarching spec

- Chart library choice, DESIGN.md tokens, responsive layout → **FE spec**.
- Exact Zod HTTP schemas, pagination → **BE spec** (contracts).
- WebSocket progress streaming → optional later; PoC can be request/response
  after precompute.

### Graduates from free-tier fog

- **Instrument EOD series endpoint** for the PoC universe (daily, ~2y). Intraday
  bars, adjusted vs raw edge cases, and indicator overlay series remain deferred
  unless FE needs overlays.
