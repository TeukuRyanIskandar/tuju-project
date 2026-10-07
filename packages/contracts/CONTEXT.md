# Context: Contract seam (`@tuju/contracts`)

The single cross-language contract seam between the TS world and the Python world
(ADR-0002, ADR-0007). Zod v4 is the **source of truth**; TS types are inferred
natively and Python Pydantic v2 models are generated from the JSON Schema this
package emits (ADR-0008).

## Responsibility

- Own the shape of the JobBus messages: `JobEnvelope`, `JobResult`, `JobProgress`,
  `JobFailure`, and the job `payloads`/`enums`.
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

## Commands

```bash
pnpm --filter contracts build      # tsc
pnpm --filter contracts generate   # regenerate JSON Schema + Python models
pnpm --filter contracts check      # verify generated output is up to date
pnpm --filter contracts test       # vitest (fixtures conformance)
```

## Decisions

System-wide ADRs in `docs/adr/` (esp. ADR-0002, ADR-0007, ADR-0008) govern this
context. No context-scoped ADRs yet.
