# Decide: fact assembly + TA event ownership

Type: grilling
Status: resolved

## Question

Parent locks: envelope payload = Bursa `stockCode` only (no facts ride the
queue); worker never touches Postgres (ADR-0004); indicators are the TS
ADR-0012 family; "facts 100% code-verifiable" is the accuracy story.

Pin how the Python worker obtains the **code-computed fact packet** for
`analyze-technical` / `analyze-fundamental`:

1. Transport: extend `BackendClient` with a worker-facing NestJS read (the
   `GET /ipo/:id/reference` precedent) vs alternatives — payload enrichment
   is contract-locked out (`TechnicalPayload` / `FundamentalPayload` are
   `{ symbol, timeframe | period }`); recomputing indicators in Python
   duplicates ADR-0012 math (two sources of truth, accuracy story damage).
2. Endpoint shape: one read per job (TA vs FA packet) vs one combined
   `/stocks/:code`-scoped reference read? Anonymous like
   `/stocks/:code/series` (worker uses the same read surface) vs the
   worker-facing-no-CORS posture of `/ipo/:id/reference`?
3. TA event detection (the 7 `TechnicalEventId`s — MA crosses with dates,
   `price_vs_sma` state, `rsi_band` label, `macd_cross`, `week52_proximity`,
   `broke_swing_high` over the prior 20 sessions): computed **TS-side** — and
   where: nightly ingest step (persisted) vs on-read recompute from stored
   bars (the CONTEXT.md "chart overlays recompute on demand" precedent) — vs
   worker-side from a served close series?
4. FA fact packet: which of the 9 `FundamentalMetricId`s are served from
   already-materialised house ratios (P/E, DY, ROE, D/E) + quarterly rows
   (QoQ/YoY growth) — and how `operating_cash_flow` is sourced (additive
   yfinance fetch, e.g. quoteSummary `financialData`, vs first-class null)?
5. Consistency: does the reference packet carry the latest EOD close day so
   the worker sets metric `asOf` (a date) and artifact `asOf` (a datetime)
   coherently?

Fixed inputs: parent spec (universe, fact defaults); BE build map (jobId
colon forms; hard-gate 404 outside KLCI 30); ADR-0004, ADR-0012, ADR-0014.

## Notes

- BE-side additions implied by any answer (reference endpoint, event
  detection, OCF ingest) are **named follow-ons in the spec's consumer
  section** — not built in this map.
- The current stub `_handle_analysis_job` ignores `backend_client`; the
  handler seam already injects it (showcase jobs use it) — PoC TA/FA
  handlers will too.

## Answer

**BackendClient reference read + TS-side on-read events + house ratios with
additive OCF fetch + one combined per-code read.**

### 1. Transport

Extend the `BackendClient` protocol / `HttpBackendClient` with one
worker-facing NestJS read (the `GET /ipo/:id/reference` precedent). The
handler seam already injects `backend_client`; the PoC TA/FA handlers use it.
Worker stays a stateless reader (ADR-0004); facts stay single-source TS
(ADR-0012); payload contracts untouched. Envelope-facts and worker-recompute
alternatives rejected (contract-locked / two-sources-of-truth).

### 2. Endpoint

- **`GET /stocks/:code/analysis/reference`** — one combined per-code read
  (not per-job reads, not the FE anonymous endpoints).
- **Anonymous** (no session; PoC reads are anonymous) and **hard-gated to
  the KLCI 30** — 404 outside, same gate as the series/analysis routes.
- **Backend-local response type**, not in `@tuju/contracts` HTTP Zod —
  mirrors the IPO-reference posture (`apps/backend/CONTEXT.md`: worker-facing
  reads stay backend-local types). Expected shape documented in the
  `BackendClient` docstring the same way `get_ipo_reference` documents its
  response.
- Response carries: identity (code, shortName), **latest EOD close +
  close day** (the asOf coherence anchor), TA block, FA block.

### 3. TA block: facts + on-read events

- Facts: SMA-20/50/200, RSI-14, MACD (12/26/9) line/signal/histogram,
  52-week high/low, latest close — the nightly materialised values.
- **Events: the 7 `TechnicalEventId`s computed TS-side, on read, from the
  stored EOD bar history** (the CONTEXT.md "recompute on demand" precedent;
  no new persistence, no ingest-step change). Same math/definitions family
  as `indicators.ts`; values always consistent with the latest bars.
- Event rows match the contract `TechnicalEvent` shape (id, label, fired,
  values, at = the event's bar date).

### 4. FA block: house ratios + additive OCF

- `trailing_pe`, `dividend_yield`, `roe`, `debt_to_equity`: served from the
  materialised house ratios (CONTEXT.md definitions).
- `revenue_growth_qoq/yoy`, `profit_growth_qoq/yoy`: computed from the stored
  quarterly rows.
- `operating_cash_flow`: **additive yfinance fetch** — BE follow-on adds the
  `financialData` module (or cash-flow time series) to
  `YFinanceFundamentalsAdapter` (+ vendor-cache row) so OCF is real. Null
  stays first-class when Yahoo lacks the field (never 0).
- Per-metric `asOf` follows its own source day: ratio metrics → latest EOD
  close day; quarterly-derived metrics (growths, OCF) → latest quarter
  `periodEnd`. Artifact `asOf` = envelope `asOf` (datetime).

### BE follow-ons named (consumer section of the spec)

1. `GET /stocks/:code/analysis/reference` endpoint + TS event detection
   (backend-local type; KLCI-30 gate).
2. Additive OCF fetch in the yfinance fundamentals adapter (+ cache row).
