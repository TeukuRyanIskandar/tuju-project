# Contracts: prospectus artifact schema (Zod -> Pydantic)

Type: task
Status: done
Blocked by: 00, 01

## Task

- Write a Zod `ProspectusArtifact` mirroring
  `services/ai/src/tuju_ai/prospectus/analysis.py:378-408`: `schemaVersion`,
  `provenance`, `company`, `headline`, the five sections (each with `routing` and
  `data`), the `shariah` and `cornerstone` insights, and `cost`.
- Read `services/ai/src/tuju_ai/llm/cost.py` first; `cost` (`tracker.report()`)
  must be typed exactly.
- Add it to `modelOrder`, regenerate, and commit the updated
  `schema/contracts.schema.json` and `models.py`.
- In `services/ai`, validate the assembled artifact with the generated model
  before writing to S3. A malformed artifact fails the job.
- Leave `analysis_models.py` alone (see ADR-0014).
- Add a golden fixture artifact under `fixtures/`.

## Done when

- `pnpm --filter @tuju/contracts check` passes.
- `pnpm run ai:test` passes, including a test that a malformed artifact fails
  the job.

## Comments

- 2026-10-07 (agent): Implemented.
  - `packages/contracts/src/artifact.ts`: strict Zod `ProspectusArtifact` (plus
    named sub-schemas, each `.meta({ id })`, all added to `modelOrder`). Includes
    the handler-added `parse` block. Nullable-not-optional for producer-dumped
    fields; `sourceSection` and cost `step` stay plain strings;
    `generatedAt` uses `z.iso.datetime({ offset: true })` because the producer
    emits `+00:00`.
  - Regenerated `contracts.schema.json` and `models.py`.
  - `handler.py` validates the artifact (after `parse` is added, before
    `put_artifact`) and raises `TerminalJobError` on `ValidationError`.
    `analysis_models.py` untouched.
  - Golden `fixtures/prospectus-artifact.json` (derived from a real
    `FakeLLMClient` run, with example names/hash), README row, TS and Python
    conformance tests, and two handler tests (missing headline; unknown key)
    asserting a terminal failure and no S3 object.
  - Verified: `@tuju/contracts` build, test (50 pass), typecheck, and `check`
    (after staging/committing the regenerated output); `pnpm run ai:test`
    115 passed, 1 skipped. The existing happy-path job test passes with
    validation on, so the current producer output matches the schema.
  - Not verified: an artifact from a real LLM/Docling run (only FakeLLMClient
    output and the fixture were validated). Schema is strict, so a real-model
    output with a value outside the closed sets (e.g. `severity`, routing
    `source`) would now fail the job terminally; `analysis_models.py` already
    normalises severity. `apps/backend` and the frontend were not touched.
