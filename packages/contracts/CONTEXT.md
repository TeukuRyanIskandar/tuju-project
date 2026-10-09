# Context: Contract seam (`@tuju/contracts`)

The single cross-language contract seam between the TS world and the Python world
(ADR-0002, ADR-0007). Zod v4 is the **source of truth**; TS types are inferred
natively and Python Pydantic v2 models are generated from the JSON Schema this
package emits (ADR-0008).

## Responsibility

- Own the shape of the JobBus messages: `JobEnvelope`, `JobResult`, `JobProgress`,
  `JobFailure`, and the job `payloads`/`enums`.
- Own the shape of the backend read endpoints' HTTP responses, as Zod schemas
  imported by both `apps/backend` and `apps/frontend` (ADR-0014). These are
  **not** registered for the Python codegen (not in `modelOrder`, no
  `.meta({ id })`).
- Own the prospectus at-a-glance `ProspectusArtifact` schema and (PoC Phase A)
  the registered TA/FA analysis artifacts (`TechnicalAnalysisArtifact` and kin).
  Unlike the HTTP schemas these are registered, so Pydantic models are generated;
  the AI worker validates the assembled artifact against them before writing to
  S3 (ADR-0014).
- Emit a JSON Schema (`schema/contracts.schema.json`) and generate the Python
  models into `services/ai/src/tuju_ai/contracts_generated/` (do not hand-edit
  the generated output).
- Ship golden `fixtures/` used for cross-language conformance tests on both sides.

## Boundaries

- No runtime dependencies on any other workspace member — this is the leaf both
  worlds depend on.
- Never import across languages. Both worlds consume this package's *output*
  (TS types via `workspace:*`; Python models via generation), never each other's code.

## Glossary

- **JobEnvelope** — the message enqueued onto the `analysis` queue.
- **JobResult** — the terminal `job.returnvalue`: a claim-check pointer + thin summary.
- **JobProgress** — step-based progress emitted via `job.updateProgress` (ADR-0007 §4).
- **JobName** — the discriminant (`analyze-technical` / `analyze-fundamental`,
  plus the spec-06 system-triggered showcase jobs `generate-market-brief` /
  `summarize-announcement`, and the prospectus at-a-glance `analyze-prospectus`
  with `ProspectusPayload = { prospectusId }`).
- **TechnicalAnalysisArtifact** — claim-checked S3 JSON for a system
  `analyze-technical` run: code-owned nested indicator facts + structured
  events, LLM narrative, provenance, and LLM cost report. No root headline and
  no verdict; the thin one-liner is `SystemSummary` on `JobResult`.
- **FundamentalAnalysisArtifact** — claim-checked S3 JSON for a system
  `analyze-fundamental` run: closed metric set with first-class nulls, shared
  narrative/provenance/cost. News is not in this artifact.
- **AnalysisNarrative** — `{ language, text }` envelope shared by TA/FA
  artifacts. PoC always writes `language: en` (Bahasa Malaysia is out of PoC).
- **AnalysisProvenance** — `{ source: real, adapter, model, generatedAt }` on
  analysis artifacts (adapter is `yfinance` for PoC).
- **StockSeriesResponse** / **StockTechnicalAnalysisResponse** /
  **StockFundamentalAnalysisResponse** — HTTP Zod (no codegen) for PoC stock
  EOD series and latest analysis reads under `http/stocks.ts`.

## Commands

```bash
pnpm --filter contracts build      # tsc
pnpm --filter contracts generate   # regenerate JSON Schema + Python models
pnpm --filter contracts check      # verify generated output is up to date
pnpm --filter contracts test       # vitest (fixtures conformance)
```

## Decisions

System-wide ADRs in `docs/adr/` (esp. ADR-0002, ADR-0007, ADR-0008, ADR-0014) govern this
context. No context-scoped ADRs yet.
