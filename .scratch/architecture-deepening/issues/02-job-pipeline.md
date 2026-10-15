# Job pipeline module; Handlers become specs

Status: resolved
Strength: Strong
Dependency category: in-process
Blocked by: 03

## Files
- `services/ai/src/tuju_ai/handler.py` (581), `ta_fa_analysis.py` (623), `graph.py` (dead), `worker.py`
- Tests: `test_handler.py`, `test_ta_fa_analysis.py`, `test_prospectus_job.py`

## Problem
Five handlers each hand-write validate → logger/bucket → jobId → progress → work → put_artifact → JobResult → done. The copies have drifted (literal schema versions, hardcoded prefixes, `_now`/`_progress` defined twice, a circular import, a triplicated 404→Terminal mapping). `_handle_analysis_job` and `graph.py` are dead.

## Direction
- `jobs/pipeline.run_job(spec, raw, deps)` owns validation, progress (phases from the 07 registry), the contract pre-write check, the claim-check, JobResult and error mapping.
- Each JobName gets a `JobSpec` whose job-specific code is `work()`.
- `TerminalJobError` moves to an `errors.py` leaf.
- Delete the dead code and update `services/ai/CONTEXT.md`.

## Tests
Pipeline invariants are tested once against a trivial spec. Per-job tests assert `work()` output. Duplicated bad-envelope and progress tests collapse.

## Comments

Resolved 2026-10-12 (uncommitted, on `refactor/architecture-deepening`).

- New `jobs/pipeline.py`: `run_job(definition, raw, deps, report_progress)` owns
  envelope validation, the `jobId` (`JOBS[name].result_id_prefix` + the
  family's key), the progress plan (`queued` → work steps → `persisting-artifact`
  → `done`; phases checked against `JOBS[name].phases` when a definition is
  built), LLM error mapping (config/permanent/still-unusable/cost ceiling →
  terminal), the contract pre-write check, the claim-check and the verdict-less
  `JobResult`. `JobContext` gives `work()` `advance(label)`, `heartbeat()`,
  `read(fetch, unknown=…)` (404 → terminal, the triplicated mapping),
  `llm_session()` and `schema_version` (from the registry).
- Named `JobDefinition` (not `JobSpec`) to avoid the registry's `JobSpec`.
  Definitions live next to their domain code: `ta_fa_analysis.TECHNICAL_JOB` /
  `FUNDAMENTAL_JOB`, `market_brief.MARKET_BRIEF_JOB`,
  `announcement_summary.ANNOUNCEMENT_SUMMARY_JOB`, `prospectus/job.PROSPECTUS_JOB`.
  `handler.handle_job(job_name, raw, *, deps, report_progress)` dispatches via
  `DEFINITIONS`. `JobDeps(artifact_store, backend, llm, parse_fn, heartbeat_seconds)`
  is built once in `worker.run()`.
- `TerminalJobError` moved to the `errors.py` leaf (the circular import is gone).
- Deleted: `graph.py`, `_handle_analysis_job`, the five hand-written handlers,
  the duplicated `_now`/`_progress`/`_heartbeat`, literal schema versions
  (`brief-1`, `announcement-summary-1`; now from the registry), and a
  `prospectus.no_risks_identified` warning that read a non-existent top-level
  key (so it fired on every run). `CONTEXT.md`/`README.md` updated;
  `langgraph` is now unused but left in `pyproject.toml` (comment says so).
- Drift fixed, visible on the wire: TA/FA `JobProgress.stepTotal` was 6 while
  `done` is step 5; every job now uses `stepTotal = index of done` (TA/FA → 5,
  same as brief/announcement/prospectus already did). Phases, labels, jobIds,
  keys and artifacts are unchanged. Nothing reads `stepTotal` today.
- TA/FA now ask for the LLM session first, so a missing key fails before the
  reference read (the prospectus job already did this).
- Tests: new `test_job_pipeline.py` (invariants once, against a trivial
  definition). Per-job bad-envelope and progress copies dropped from
  `test_handler.py`, `test_ta_fa_analysis.py` and `test_prospectus_job.py`, and
  the TA/FA tests that monkeypatched `model_validate` dropped (the pipeline test
  covers the pre-write check; happy paths validate the stored artifact against
  the contract). Per-job tests run through `handle_job` with `JobDeps`.
  Unit lane 189 → 199 passed; integration 2 passed; smoke OK.
- Verified with a throwaway HEAD worktree: TA, FA, brief and announcement
  artifacts and `JobResult`s are identical to before (timestamps masked); the
  only progress difference is the TA/FA `stepTotal` 6 → 5 above.
