# Spec: PoC / Phase A — Contracts handoff (TA/FA artifacts + stock HTTP)

Status: ready-for-agent

> Handoff produced by `to-spec` from the
> [PoC / Phase A contracts wayfinder map](map.md).
> Source decisions: tickets
> [01](issues/01-ta-artifact-shape.md)–[05](issues/05-http-analysis-reads.md).
>
> **Scope of this document:** the shared **wire** for PoC Phase A — registered
> Zod rich artifacts for technical / fundamental analysis, JobResult summary
> policy, and HTTP Zod for stock EOD series + latest analysis reads. It is
> **not** a BE, worker, or FE build ticket list — those consume this seam.
>
> **Fixed inputs:** parent [PoC / Phase A overarching](../poc-phase-a/spec.md);
> ADR-0007, ADR-0008, ADR-0014; `packages/contracts/CONTEXT.md`.
>
> **Planning only:** this map does **not** merge Zod into `packages/contracts`.
> Execution is a later contracts build pass and/or folded into BE/worker/FE maps.

## Problem Statement

PoC Phase A product locks are set (KLCI 30, system-precompute, descriptive
TA/FA, one stock screen), but the **shared contracts seam** is unset: workers
cannot validate a rich S3 artifact, Nest cannot type series / analysis reads,
and FE cannot rely on honest pending/ready/stale states without re-debating
shapes.

## Solution

Pin three contract layers:

1. **Registered artifacts** (codegen / `modelOrder`): `TechnicalAnalysisArtifact`,
   `FundamentalAnalysisArtifact`, plus shared narrative / provenance envelopes;
   prospectus-style `cost` on S3 only.
2. **JobBus policy**: PoC TA/FA emit `SystemSummary` only; no Zod discriminant
   surgery in this pass; Verdict enums remain unused by PoC.
3. **HTTP Zod** (no codegen): stock EOD series + technical / fundamental analysis
   reads under `packages/contracts/src/http/stocks.ts`, mirroring prospectus
   claim-check + Nest-proxied `artifactPath` (cost stripped).

## Consumers

| Consumer | Uses |
| --- | --- |
| **Worker map** | Validate artifacts before S3 write; return `SystemSummary` on `JobResult` |
| **BE map** | Persist pointers; implement series + analysis routes; proxy cost-stripped artifacts |
| **FE map** | Typed queries; chart from series; cards from status + thin fields + proxied rich JSON |
| **Contracts execution** | Add Zod + fixtures named below (may be its own pass) |

## Implementation Decisions

### Shared envelopes (tickets 01–02)

Reuse across TA and FA (do not fork):

| Type | Shape | Notes |
| --- | --- | --- |
| `AnalysisNarrative` | `{ language: 'en' \| 'ms', text }` | PoC writers **always** `language: 'en'` (overrides parent BM narration for the PoC app) |
| `AnalysisProvenance` | `{ source: 'real', adapter: 'yfinance', model, generatedAt }` | `generatedAt` ISO datetime with offset |
| `cost` | Reuse `ProspectusCostReport` (or shared alias at execution) | On S3 artifact only; **HTTP proxy must strip** |

No root `headline` on either artifact — headline lives on `JobResult.summary`
(`SystemSummary`) and on thin analysis HTTP.

### `TechnicalAnalysisArtifact` (ticket 01)

- `.meta({ id })` → `modelOrder`; `schemaVersion: 'technical-analysis-1'`.
- Root (strict): `schemaVersion`, `symbol`, `jobName: 'analyze-technical'`,
  `asOf`, `timeframe: '1D'`, `facts`, `events`, `narrative`, `provenance`,
  `cost`.
- **`facts`:** `sma { p20, p50, p200 }`, `rsi { period: 14, value }`,
  `macd { line, signal, histogram }`, `week52 { high, low }` — numbers as
  numbers; insufficient history → required-nullable fields (never optional keys).
- **`events`:** `{ id, label, fired, values, at }` with closed `id` enum:
  `ma_cross_20_50` | `ma_cross_50_200` | `price_vs_sma` | `rsi_band` |
  `macd_cross` | `week52_proximity` | `broke_swing_high`. English `label` only.
- Out: root headline, verdict/advice, news, prospectus `parse` block.

### `FundamentalAnalysisArtifact` (ticket 02)

- `.meta({ id })` → `modelOrder`; `schemaVersion: 'fundamental-analysis-1'`.
- Root (strict): `schemaVersion`, `symbol`, `jobName: 'analyze-fundamental'`,
  `asOf`, `period: 'quarterly'`, `metrics`, `narrative`, `provenance`, `cost`.
- **`metrics`:** full closed set always present; each
  `{ id, label, value: number \| null, unit, asOf }`.
  - Ids: `trailing_pe`, `dividend_yield`, `roe`, `revenue_growth_qoq`,
    `revenue_growth_yoy`, `profit_growth_qoq`, `profit_growth_yoy`,
    `debt_to_equity`, `operating_cash_flow`.
  - Null first-class; never omit a metric; never coerce null → `0`.
- News is **not** in this artifact (stock-screen / news HTTP only).

### JobResult / `SystemSummary` policy (ticket 03)

- PoC `analyze-technical` / `analyze-fundamental` **must** use
  `summary: SystemSummary` (`{ headline, asOf }`).
- Keep `JobResult.summary` as `Summary | SystemSummary` — **no** per-`jobName`
  Zod discriminant unless a later consumer forces it.
- `ArtifactPointer` on `JobResult` unchanged (ADR-0007).
- Do not delete Verdict enums.
- **Fixtures to add at execution:**
  - `packages/contracts/fixtures/job-result-technical-system.json`
  - `packages/contracts/fixtures/job-result-fundamental-system.json`
  - Keep existing verdict-bearing `job-result.json` for non-PoC paths.

### HTTP: stock series (ticket 04)

File: `packages/contracts/src/http/stocks.ts` (HTTP Zod only).

`GET /stocks/:code/series?interval=1d&range=2y`

`StockSeriesResponse`:

| Field | Type |
| --- | --- |
| `code` | string |
| `interval` | `'1d'` |
| `range` | `'2y'` (PoC-fixed; do **not** reuse `IndexSeriesRange`) |
| `points` | `{ date, open, high, low, close, volume }[]` — dates `IsoDate`; OHLC+volume **string NUMERIC** |
| `provenance` | `ProvenanceClass` — PoC yfinance = `real` |
| `demoLabel` | `'private-demo'` (UI maps to non-redistributable chip copy) |

Empty `points` allowed (honest empty). No adjusted-close / intraday in PoC.

### HTTP: analysis reads (ticket 05)

Same file: `http/stocks.ts`.

| Method | Path | Type |
| --- | --- | --- |
| GET | `/stocks/:code/analysis/technical` | `StockTechnicalAnalysisResponse` |
| GET | `/stocks/:code/analysis/fundamental` | `StockFundamentalAnalysisResponse` |

**Status enum (required):** `pending` | `running` | `ready` | `facts_only` |
`failed` | `stale`.

**Thin envelope (prospectus-style):**

- Always: `code`, `jobName` (literal per endpoint), `status`.
- When result exists (`ready` | `facts_only` | `stale`): `headline`, `asOf`,
  `artifact: { bucket, key }`, `artifactPath` (Nest proxy).
- `pending` / `running`: those fields **null** (required-nullable keys).
- `failed`: safe `errorMessage`; artifact fields null by PoC default.
- `stale`: same payload as ready + status chip for “not latest close”.

**Rich body:** proxied TA/FA artifact with **`cost` stripped**. FE must not see
cost. Prefer loading facts/events/metrics/narrative via `artifactPath` rather
than duplicating them on the thin response.

News endpoints are out of this handoff (existing news HTTP).

## Execution checklist (contracts / BE / worker — not done here)

- [ ] Add shared `AnalysisNarrative` / `AnalysisProvenance` (+ cost reuse).
- [ ] Register `TechnicalAnalysisArtifact` + `FundamentalAnalysisArtifact` in
      `modelOrder` / JSON Schema export.
- [ ] Add HTTP schemas in `http/stocks.ts`; export from package index as needed.
- [ ] Add the two `job-result-*-system.json` fixtures + tests.
- [ ] Nest: series route; analysis routes; proxy strips `cost`.
- [ ] Worker: emit SystemSummary; validate artifacts before S3 write.

## Out of Scope

- Implementing / merging the Zod above in this wayfinding map.
- yfinance adapter, KLCI 30 seed, ingest cron, system enqueue (→ BE map).
- LangGraph, prompts, grounding post-check, USD ceiling (→ worker map).
- DESIGN.md, chart library, card layout (→ FE map).
- BM i18n for PoC; deleting Verdict enums; paid click-to-run.
- Renaming wire phase `synthesizing-verdict` → `drafting-narrative`.
- Stock series ranges beyond `2y`; indicator overlay series.

## Acceptance

- [x] Map tickets 01–05 resolved; ticket 06 wrote this spec.
- [x] Destination marked reached on [`map.md`](map.md).
- [ ] Child BE / worker / FE maps can consume this seam without re-opening
      artifact roots, metric/event ids, SystemSummary policy, series shape, or
      analysis HTTP status enum.
- [ ] Contracts execution (or folded build tickets) lands Zod + fixtures named
      above.
