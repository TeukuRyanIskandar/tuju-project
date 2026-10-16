# 01 — Add an explicit percentage scale to FundamentalMetric

Type: task
Status: resolved
Blocked by: none
Severity: high
Component: `packages/contracts`

## Problem

`FundamentalMetric.unit` (`packages/contracts/src/artifact.ts:472`) is
`z.string().min(1)`. It carries no information about scale, so a consumer cannot
tell whether `0.045` means 4.5% or 0.045%.

It does not need to guess today, because the backend is inconsistent
([02](02-backend-fa-scale-producer.md)): it stamps `unit: '%'` on both fractions
and percentage points, and the golden fixture uses a third vocabulary
(`ratio` / `percent` / `myr`) again. The frontend has been compensating with a
hardcoded per-metric-id table at
`apps/frontend/src/components/stocks/analysis-presentation.ts:22-24`.

This ticket makes each metric self-describing so no consumer has to encode
producer knowledge.

## Evidence

- `packages/contracts/src/artifact.ts:454-476` — `FundamentalMetricId` enum and
  the strict object. Registered via `.meta({ id: 'FundamentalMetric' })`.
- `packages/contracts/src/jsonSchema.ts:74` — `FundamentalMetric` is in
  `modelOrder`, so it is emitted into the JSON Schema **and** generated into
  `services/ai/src/tuju_ai/contracts_generated/models.py`. Unlike the browser
  proxy schemas in `packages/contracts/src/http/stocks.ts:178-181`, this is a
  wire-affecting, cross-language change.
- `packages/contracts/src/schema-versions.ts:3` —
  `fundamental: 'fundamental-analysis-1'`.
- `../../readiness.md:55` — `0` FA analyses exist locally, so no stored artifact
  breaks.

## Root cause

The unit field was designed as a display string, but producers need two
independent facts: the unit, and whether the number is a fraction or an already
multiplied percentage. Only the first is modelled.

## Open question — this is why the ticket is `needs-info`

`FundamentalMetric` is wire-affecting, so ADR-0008 discipline applies. Decide:

- **Option A (recommended):** add a required `scale` field and bump
  `SCHEMA_VERSIONS.fundamental` to `fundamental-analysis-2`. Clean and forces
  every producer to be explicit. Breaks any FA artifact already stored in an
  environment this audit could not see. Locally safe — zero FA analyses exist
  (`../../readiness.md:55`) — but **confirm no other environment has stored FA
  artifacts before choosing this.**
- **Option B:** add `scale` as optional with a default of `absolute`. No version
  bump, no stored artifact breaks — but old artifacts would parse and silently
  label a fraction as `absolute`, which is worse than failing loudly. Only
  choose this if stored artifacts must keep parsing.

## Fix

1. Add `scale: z.enum(['fraction', 'percentage_point', 'absolute'])` to
   `FundamentalMetric` in `packages/contracts/src/artifact.ts:467-475`.
2. Apply the chosen option from the open question above — including the
   `SCHEMA_VERSIONS.fundamental` bump in
   `packages/contracts/src/schema-versions.ts` if Option A.
3. Run `pnpm --filter contracts generate`. Commit the regenerated
   `packages/contracts/schema/contracts.schema.json` and
   `services/ai/src/tuju_ai/contracts_generated/`. **Do not hand-edit generated
   output.**
4. Update `packages/contracts/fixtures/fundamental-analysis-artifact.json` — all
   8 metric rows carry `scale` alongside the existing `unit`.
5. Update `packages/contracts/test/fixtures.test.ts` if it asserts the metric
   shape.
6. Update `packages/contracts/CONTEXT.md` to describe `scale` in the
   `FundamentalAnalysisArtifact` glossary entry.

Keep `unit`. It is still the right display string and removing it is a separate,
larger change.

## Acceptance criteria

- `FundamentalMetric` carries an explicit scale that a consumer can act on with
  no knowledge of which metric id it is looking at.
- `pnpm --filter contracts check` passes with the regenerated artifacts
  committed, proving no hand-editing of generated files.
- The fixture and conformance tests validate against the regenerated models.
- If Option A, `SCHEMA_VERSIONS.fundamental` is bumped and
  `schema_versions.py` reflects it.

## Verification

```bash
pnpm --filter contracts check
pnpm --filter contracts test
pnpm --filter contracts build
```

The `check` gate is the real test here — it regenerates and fails on any diff
against HEAD, which is the ADR-0008 drift signal.

## Limits

- Does not make the backend correct; see [02](02-backend-fa-scale-producer.md).
  Until that lands, generated artifacts will not validate because the producer
  omits `scale`.
- Does not change metric values. Scaling presentation is
  [04](04-frontend-scale-presentation.md).
- The Python model's regenerated shape is consumed by
  [03](03-ai-worker-scale-passthrough.md); that ticket must land before any
  worker run, or every FA job will fail contract validation terminally.
## Comments

**Resolved 2026-10-16 — Option A, commit `047d362`.**

`FundamentalMetricScale` (`fraction` / `percentage_point` / `absolute`) is
required on `FundamentalMetric`; `SCHEMA_VERSIONS.fundamental` is now
`fundamental-analysis-2`. Registered codegen output regenerated, never hand-edited;
`pnpm --filter contracts check` passes.

Deviations from the ticket as written, both deliberate:

- **The fixture was realigned to the producer, not just annotated.** The ticket
  said "all 8 metric rows carry `scale`". There are nine, and the fixture was the
  third source of the ambiguity: it used `percent`/`ratio`/`myr` where the backend
  emits `%`/`x`/`RM bn`, and stored growth as fractions where the backend emits
  percentage points. Annotating it would have left the golden file encoding a
  shape no producer emits. Values were multiplied by 100 for the four growth rows
  to match; no other value changed. Rendered output is identical, because the old
  fraction values under the old unit cancelled out.
- **`packages/contracts/test/fixtures.test.ts` carried unrelated work into the
  commit** — the opt-in captured-timestamp tests from ticket 05 were already
  uncommitted in that file. Disclosed in the commit body.

On the open question's safety claim: `readiness.md:55` does **not** show zero FA
analyses. It reads "FA: 24 pending / 4 failed / 2 facts_only"; the zero on that
line is prospectus analyses. Option A therefore strands 2 local `facts_only` FA
artifacts, which now fail `StockFundamentalAnalysisArtifact.safeParse` and render
as "Analysis detail unavailable". Ticket 09's re-run replaces them. No other
environment was inspectable.
