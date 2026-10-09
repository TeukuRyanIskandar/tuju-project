# Decide: FundamentalAnalysisArtifact shape

Type: grilling
Status: resolved
Blocked by: (none)

## Question

Same claim-check pattern as TA, but FA is **metrics** (not chart events) with
first-class nulls (e.g. bank D/E).

Pin the **registered Zod** shape for the PoC fundamental artifact:

1. Schema name + `schemaVersion` literal?
2. Top-level fields (symbol, jobName, asOf, period, …)?
3. How are **metrics** modelled (id, label, value nullable, unit, asOf)?
4. Narrative + provenance: shared with TA ticket 01 or FA-specific?
5. Does news belong in this artifact, or only on the HTTP stock screen?

Fixed inputs: parent tickets 03 + 05 (descriptive policy, Pitch Feedback metric
list). News is a separate on-screen list in the parent — default bias: **not**
inside the FA artifact.

## Notes

- Prefer structural kinship with ticket 01 (shared narrative/provenance types)
  without forcing a single mega-schema.
- Null metrics must parse; do not coerce to 0.

## Answer

**Registered `FundamentalAnalysisArtifact` (`schemaVersion: fundamental-analysis-1`):
closed-enum metrics with first-class nulls, shared narrative / provenance / cost
envelopes from ticket 01; no root headline; news stays off this artifact.**

### Identity

- Schema: `FundamentalAnalysisArtifact` with `.meta({ id })` → `modelOrder`.
- `schemaVersion`: literal `fundamental-analysis-1`.

### Root fields (strict)

- `schemaVersion`
- `symbol`
- `jobName`: literal `analyze-fundamental`
- `asOf`
- `period`: literal `quarterly` (PoC default from parent ticket 02; growth
  metrics use quarterly statements; valuation ratios use TTM / trailing as the
  vendor provides — period on the root is the growth anchor, not a claim that
  every ratio is quarterly)
- `metrics`
- `narrative`
- `provenance`
- `cost` (prospectus-style / shared LLM cost report)

No root `headline` — the one-liner lives only on `JobResult.summary` as
`SystemSummary`. No `verdict` / buy-sell / advice fields.

### `metrics`

Fixed-length array (or equivalent object keyed by id — **prefer array of all
closed ids so producers cannot omit a key**). Each element:

`{ id, label, value, unit, asOf }`

- `id`: closed enum —
  - `trailing_pe`
  - `dividend_yield`
  - `roe`
  - `revenue_growth_qoq`
  - `revenue_growth_yoy`
  - `profit_growth_qoq`
  - `profit_growth_yoy`
  - `debt_to_equity`
  - `operating_cash_flow`
- `label`: English display string (no `labelKey`; no BM i18n in PoC) — e.g.
  “Trailing P/E”, “Dividend yield”, …
- `value`: `number | null` — **null is first-class** (banks D/E, missing
  quarters, non-positive EPS). Never omit the metric; never coerce null → `0`.
- `unit`: short English unit string (`ratio`, `percent`, `myr`, …) — handoff
  may keep this as plain string; execution may tighten if needed
- `asOf`: ISO date (or datetime with offset) for the observation that produced
  the value; when `value` is null, still emit the as-of of the attempted
  snapshot/read

Kinship with TA `events`: closed id + English label + structured payload; FA
uses nullable `value` + `unit` instead of `fired` / `values` / `at`.

### Shared envelopes (from ticket 01 — reuse, do not fork)

- **`AnalysisNarrative`**: `{ language: 'en' | 'ms', text }` — PoC writers
  **always** emit `language: 'en'`.
- **`AnalysisProvenance`**: `{ source: 'real', adapter: 'yfinance', model,
  generatedAt }`.
- **`cost`**: reuse prospectus cost-report shape (`ProspectusCostReport` or a
  shared alias at execution time). Lives on S3; **must not reach FE** — analysis
  HTTP (ticket 05) strips / omits `cost`.

### Deliberately out of this artifact

- Root `headline` / duplicate of `SystemSummary`
- `verdict` / buy-sell / advice fields
- News items (parent ticket 05 + 07: separate stock-screen HTTP / news routes)
- Peer-relative valuation, PDF/annual-report extraction, Naim preset validation

### Unblocks

- Analysis HTTP read shape (ticket 05) for FA thin fields + cost-stripping
- JobResult SystemSummary fixtures for fundamental (ticket 03)
