# Job registry generated across the contract seam

Status: resolved
Strength: Worth exploring
Dependency category: in-process (codegen)
Blocked by: none
Supersedes: .scratch/architecture-review/issues/05

## Files
- `packages/contracts/src/enums.ts`, `scripts/generate.mjs`, `scripts/check.mjs`
- `services/ai/src/tuju_ai/config.py:13–33` (hand-mirrored `JOB_*`, `*_RESULT_PREFIX`)
- `apps/backend/src/jobbus/job-names.ts`, `apps/backend/src/ipo/ipo.mapping.ts:17`
- `services/ai/src/tuju_ai/contracts_generated/` (generated output)

## Problem
Job names, result-id prefixes and schema versions are mirrored by hand in both worlds. The generator already emits `schema_versions.py` but stops short of these. Python's `JobProgress.phase` is the union of every phase, so ADR-0007 §4 (fixed phases per job type) is not enforced.

## Direction
- Add one `JOBS` registry in `@tuju/contracts`: `{ name, phases (ordered), resultIdPrefix, schemaVersion }` per JobName, plus the queue name.
- Generate it into Python (for example `contracts_generated/job_registry.py`). The drift gate (`check.mjs`) covers it.
- `config.py` and the backend import from it instead of hand-mirroring.
- Contract shapes stay unchanged: this ticket adds metadata only.

## Tests
- A contracts unit test that every `JobName` has a registry entry.
- A Python conformance test that the registry matches the generated enums.
- The drift gate passes.

## Comments

**Resolved (agent, uncommitted).**
- `packages/contracts/src/job-registry.ts` (exported from `index.ts`): `ANALYSIS_QUEUE = 'analysis'`, `JOBS` keyed by `JobName` with `{ name, queue, phases, resultIdPrefix, schemaVersion }` (`satisfies { [N in JobName]: JobSpec & { name: N } }`, so a missing `JobName` is a compile error), plus types `JobQueue`, `JobSpec`, `JobRegistry`, `ResultIdPrefix<N>`. Phases come from the per-job enums in `enums.ts`; schema versions from `SCHEMA_VERSIONS`. Result-id prefixes: `technical:`, `fundamental:`, `brief:`, `ann:`, `prospectus:` (what the worker actually mints in `ta_fa_analysis.py` / `handler.py`).
- `scripts/generate.mjs` step 5 emits `services/ai/src/tuju_ai/contracts_generated/job_registry.py` from the built `dist/job-registry.js` (`QUEUE_ANALYSIS`, `JOB_*` name constants, frozen `JobSpec(name, queue, phases, result_id_prefix, schema_version)`, `JOBS`). `__init__.py` re-exports `JOBS, JobSpec`. `check.mjs` already covers the whole `contracts_generated/` dir, so no change was needed there. `models.py` and the JSON Schema are byte-identical (no shape change).
- `services/ai/src/tuju_ai/config.py`: the hand-mirrored `QUEUE_ANALYSIS`, `JOB_*` and `*_PREFIX` constants are now imported from or derived from the generated registry, under the same names, so no call sites changed.
- Backend (type-only, ESM/CJS constraint kept): `ANALYSIS_QUEUE: JobQueue` in `jobbus/job-names.ts`; `PROSPECTUS_RESULT_JOB_ID_PREFIX: ResultIdPrefix<'analyze-prospectus'>` in `ipo/ipo.mapping.ts`. Drift is now a `tsc` error.
- Tests: `packages/contracts/test/job-registry.test.ts` (one entry per JobName, phases are queued→done, unique and within `Phase`, unique colon prefixes, union of phases equals `Phase`); `services/ai/tests/test_job_registry.py` (registry vs the generated `JobProgress.phase` literal, the TA/FA/prospectus artifact `jobName`/`schemaVersion` literals, and the config re-exports). `JobName` itself is not emitted into `models.py`, so the TS test owns the "every JobName has an entry" check.
- Not done here: the BullMQ hyphen-id prefix is not in the registry. Per spec Decisions it belongs to each job family (ticket 01). `brief/market-brief.store.ts` and `disclosures/announcement-summary.store.ts` still hard-code `'brief:'` / `'ann:'`. Ticket 01 replaces them, and can type them with `ResultIdPrefix<…>` the same way. Python `JobProgress.phase` is still the union; ticket 02's pipeline should use `JOBS[name].phases`.

