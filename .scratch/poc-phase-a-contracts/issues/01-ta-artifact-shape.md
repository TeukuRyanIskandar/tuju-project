# Decide: TechnicalAnalysisArtifact shape

Type: grilling
Status: resolved
Blocked by: (none)

## Question

Parent PoC locks a rich S3 JSON for TA: code-owned **facts/events** + LLM
**narrative** + provenance, claim-checked like `ProspectusArtifact` (ADR-0014).

Pin the **registered Zod** shape for the PoC technical artifact so the worker can
validate before S3 write and FE/BE can document the proxied read:

1. Schema name + `schemaVersion` literal?
2. Top-level fields (symbol, jobName, asOf, timeframe, …)?
3. How are TA **events** modelled (id, label, value, at, related indicators)?
4. Shared **narrative** + **provenance** envelopes (reuse prospectus pieces or
   new PoC-specific objects)?
5. What stays out of the artifact (thin `SystemSummary` only on JobResult)?

Fixed inputs: parent tickets 03 + 04 (descriptive policy, SMA/RSI/MACD/52w event
set). Do not invent buy/sell fields.

## Notes

- Mirror: `packages/contracts/src/artifact.ts` `ProspectusArtifact`.
- Parent sketch (not normative): `facts` / `events` / `narrative` / `provenance`.
- Codegen: must use `.meta({ id })` and land in `modelOrder`.

## Answer

**Registered `TechnicalAnalysisArtifact` (`schemaVersion: technical-analysis-1`):
nested code facts, closed-enum events with English labels, shared narrative /
provenance / cost envelopes; no root headline; BM dropped for PoC (overrides
parent ticket 06).**

### Identity

- Schema: `TechnicalAnalysisArtifact` with `.meta({ id })` → `modelOrder`.
- `schemaVersion`: literal `technical-analysis-1`.

### Root fields (strict)

- `schemaVersion`
- `symbol`
- `jobName`: literal `analyze-technical`
- `asOf`
- `timeframe`: literal `1D` (PoC only precomputes daily)
- `facts`
- `events`
- `narrative`
- `provenance`
- `cost` (prospectus-style / shared LLM cost report)

No root `headline` — the one-liner lives only on `JobResult.summary` as
`SystemSummary`.

### `facts` (nested)

- `sma`: `{ p20, p50, p200 }` (close-based)
- `rsi`: `{ period: 14, value }`
- `macd`: `{ line, signal, histogram }` (12,26,9)
- `week52`: `{ high, low }`

Numbers as numbers; absent/insufficient history → required-nullable fields (same
producer convention as prospectus: never optional keys).

### `events`

Each: `{ id, label, fired, values, at }`.

- `id`: closed enum — `ma_cross_20_50` | `ma_cross_50_200` | `price_vs_sma` |
  `rsi_band` | `macd_cross` | `week52_proximity` | `broke_swing_high`
- `label`: English display string (no `labelKey`; no BM i18n in PoC)
- `fired`: boolean
- `values`: structured levels for that event (loose/record OK at handoff; BE may
  tighten per-id later)
- `at`: ISO date of the bar that decided the event

### Shared envelopes (also for FA ticket 02)

- **`AnalysisNarrative`**: `{ language: 'en' | 'ms', text }` — PoC writers
  **always** emit `language: 'en'`. Explicit override of parent PoC ticket 06
  (BM narration): BM is **not** part of the PoC app.
- **`AnalysisProvenance`**: `{ source: 'real', adapter: 'yfinance', model,
  generatedAt }` (`generatedAt` ISO datetime with offset, prospectus-style).
- **`cost`**: reuse shared prospectus cost-report shape (model, calls, tokens,
  estimatedCostUsd, ceilingUsd, perCall). Lives on the S3 artifact for ops
  traceability. **Must not reach FE** — analysis HTTP (ticket 05) strips or
  omits `cost` when proxying.

### Deliberately out of this artifact

- Root `headline` / duplicate of `SystemSummary`
- `verdict` / buy-sell / advice fields
- News items
- `parse` block (no PDF)

### Unblocks

- FA artifact kinship (ticket 02) for shared narrative/provenance/cost
- Analysis HTTP read shape (ticket 05) for cost-stripping policy
