# PoC / Phase A Contracts Map — TA/FA artifact + stock HTTP

Label: `wayfinder:map`

## Destination

**Reached.** Handoff:
[PoC Phase A contracts spec](spec.md) (`ready-for-agent`).

One **contracts handoff spec** that pins the shared wire for PoC Phase A:
registered Zod **TA/FA rich artifacts** (facts + narrative, prospectus-style) and
**HTTP** schemas for stock EOD series + latest analysis reads, with PoC
`analyze-technical` / `analyze-fundamental` results using **`SystemSummary`**.
BE / worker / FE implementation maps consume this; they do not re-shape the seam.

## Notes

- **Planning only.** Resolve decisions; `to-spec` writes the handoff. No Zod
  code in this map (execution is a later contracts build pass or folded into
  BE/worker execution).
- **Parent:** [PoC / Phase A overarching](../poc-phase-a/spec.md) — destination
  already reached. Product locks (universe, system trigger, descriptive policy,
  fact defaults, grounding, one-screen blocks) are **fixed inputs**.
- **Fixed ADRs:** ADR-0007 (JobBus), ADR-0008 (Zod → JSON Schema → Pydantic),
  ADR-0014 (HTTP Zod + claim-checked artifacts; prospectus pattern to mirror).
- **Context:** `packages/contracts/CONTEXT.md`. Artifacts get `.meta({ id })` +
  codegen; HTTP schemas do **not** enter `modelOrder`.
- **Skills:** `grilling` + `domain-modeling` for decide tickets; `to-spec` for
  the final handoff. No research tickets expected unless a prior shape blocks.
- **Deferred from this map:** `synthesizing-verdict` → `drafting-narrative`
  rename (non-blocking; stays fog / out of route).

## Decisions so far

- [Decide: TechnicalAnalysisArtifact shape](issues/01-ta-artifact-shape.md):
  `TechnicalAnalysisArtifact` / `technical-analysis-1`; nested facts; 7-id
  event enum + English `label`; shared `AnalysisNarrative` (`en`|`ms`, PoC=`en`),
  `AnalysisProvenance`, prospectus-style `cost` on S3 (FE must not see cost);
  no root headline; BM dropped for PoC (overrides parent 06).
- [Decide: FundamentalAnalysisArtifact shape](issues/02-fa-artifact-shape.md):
  `FundamentalAnalysisArtifact` / `fundamental-analysis-1`; `period: quarterly`;
  9-id metrics enum with `value: number | null` (never omit / never coerce 0);
  reuses ticket-01 narrative / provenance / cost; news out of artifact.
- [Decide: PoC JobResult SystemSummary policy](issues/03-jobresult-system-summary-policy.md):
  docs + fixtures only; no per-`jobName` Zod discriminant; pointer unchanged;
  add `job-result-technical-system.json` /
  `job-result-fundamental-system.json` at execution.
- [Decide: HTTP stock series](issues/04-http-stock-series.md):
  `GET /stocks/:code/series` in `http/stocks.ts`; PoC-fixed `1d`/`2y`; OHLC+volume
  string NUMERIC; `provenance: real` + `demoLabel: private-demo`.
- [Decide: HTTP analysis reads](issues/05-http-analysis-reads.md):
  prospectus-style thin + claim-check + `artifactPath`; cost stripped on proxy;
  status enum `pending|running|ready|facts_only|failed|stale`; types in
  `http/stocks.ts`.
- [Task: contracts handoff spec](issues/06-overarching-to-spec.md):
  wrote [`spec.md`](spec.md).

## Not yet specified

- Exact golden fixture bodies (filenames pinned in ticket 03; contents at
  contracts execution).
- Optional later: per-job summary discriminant tightening on `JobResult`
  (parent said additive if needed).
- Stock series ranges beyond PoC-fixed `2y`; indicator overlay series.

## Out of scope

- yfinance adapter, KLCI 30 seed, ingest cron, system enqueue CLI (→ BE map).
- LangGraph, prompts, grounding post-check impl, cost ceiling USD (→ worker map).
- DESIGN.md, chart library, card layout (→ FE map).
- Bahasa Malaysia copy / BM i18n for PoC (explicitly dropped; English only).
- Deleting Verdict enums or paid click-to-run shapes.
- Phase-label rename on the wire (deferred; keep `synthesizing-verdict`).
- Building / merging Zod into `packages/contracts` (execution after this map).
