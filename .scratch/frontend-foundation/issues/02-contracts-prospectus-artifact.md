# Contracts: prospectus artifact schema (Zod -> Pydantic)

Type: task
Status: ready-for-agent
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
