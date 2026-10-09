# Decide: series + analysis read routes + proxy

Type: grilling
Status: resolved
Blocked by: 04

## Question

Contracts already define:

- `GET /stocks/:code/series?interval=1d&range=2y` → `StockSeriesResponse`
- `GET /stocks/:code/analysis/technical` → `StockTechnicalAnalysisResponse`
- `GET /stocks/:code/analysis/fundamental` → `StockFundamentalAnalysisResponse`

plus Nest-proxied `artifactPath` with **`cost` stripped**.

Pin **Nest wiring** (not Zod):

1. Controller placement (`stocks.controller` vs new module)?
2. Series source: PriceBar query window (~2y EOD); empty points allowed; how
   `demoLabel: private-demo` is set for yfinance rows?
3. Analysis thin read: map persistence + optional live job state → status enum.
4. Artifact proxy path naming (mirror IPO `/artifact`)? Auth = anonymous?
5. 404 vs empty for unknown / non-KLCI codes (depends on ticket 01 gating)?

Fixed inputs: contracts tickets 04–05; existing `GET /stocks/:code` + IPO
at-a-glance proxy prior art; ADR-0014.

## Notes

- News stays on existing news HTTP — out of this ticket.
- Do not change contracts schemas in this map.

## Answer

**Extend `stocks.controller`; 404 outside KLCI 30; artifact under
`/stocks/:code/analysis/{technical|fundamental}/artifact`; anonymous; cost
stripped on proxy.**

### 1. Placement

- Add routes on **`StocksController` / stocks module** next to
  `GET /stocks/:code`.
- Implementation may use dedicated service files (series / analysis read /
  artifact proxy) — module boundary stays stocks for the public surface.

### 2. Series

- Source: **EOD `PriceBar` (or equivalent)** for the instrument, window ≈ last
  **2y**, `interval=1d` / `range=2y` as contracts literals (reject other
  query values with 400).
- **Empty `points: []` allowed** when seeded but not yet ingested (200).
- `provenance`: from stored bars / instrument provenance (`real` on yfinance
  path).
- `demoLabel`: always **`private-demo`** on this PoC series response (contracts
  literal) regardless of free-tier synthetic elsewhere.
- Hard-gate: non-30 → **404** before querying bars.

### 3. Analysis thin read

- Load ticket 04 row by Instrument; map to contracts thin fields.
- **No row** → HTTP **200** with `status: 'pending'`, null headline/asOf/
  artifact/artifactPath/errorMessage (pre-enqueue UX).
- Row present → return stored `status` (+ fields). Build may additionally
  promote to `stale` on read when `as_of` date &lt; latest EOD close day for
  that instrument (ticket 04 rule).
- `artifactPath` set only when pointer exists (`ready` / `facts_only`):
  `/stocks/{code}/analysis/technical/artifact` or
  `/stocks/{code}/analysis/fundamental/artifact`.
- `jobName` literals per contracts.

### 4. Artifact proxy

| Method | Path |
| --- | --- |
| GET | `/stocks/:code/analysis/technical/artifact` |
| GET | `/stocks/:code/analysis/fundamental/artifact` |

- **Anonymous** (same posture as IPO at-a-glance artifact).
- Nest fetches S3 via claim-check pointer; **strip `cost`** (and any other
  internal billing fields) before returning JSON (ADR-0014 / contracts).
- 404 if non-30, no row, or no pointer / missing object.
- Mirror IPO proxy patterns (content-type, error mapping).

### 5. Gating

- Outside KLCI 30 seed **or** unknown code → **404** on series, analysis thin
  reads, and artifact proxy (and PoC stock core if/when gated the same way).
- Do not 200-empty for out-of-universe codes.

### Unblocks

- Ticket 07 handoff HTTP section.
- FE map can bind to fixed paths without further BE fog.
