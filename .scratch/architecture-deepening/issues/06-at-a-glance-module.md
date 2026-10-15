# At-a-glance analysis as one deep module

Status: resolved
Strength: Worth exploring
Dependency category: local-substitutable (parse fn, S3 parse cache) + ports & adapters (LLM)
Blocked by: 02

## Files
- `handler.py` (`_handle_prospectus`, `_PROSPECTUS_STEPS`, `_STEP_INDEX`, `_heartbeat`, `_default_parse_fn`)
- `prospectus/analysis.py` (458; `STEP_*`/`LLM_STEPS` 64–82; `derivedFrom` 447)
- `llm/fake.py` (`_CANNED`), `prospectus/analysis_models.py`

## Problem
A step's identity lives in 4 hand-kept lists. The handler mutates the returned artifact. **Bug:** `derivedFrom` lists 4 sections while the reduce step is fed 6.

## Direction
`prospectus.analyze(reference, pdf, deps, on_progress) -> artifact` owns parse reuse, routing, steps, metadata and validation, driven by one declarative `STEPS` list. The progress plan, `LLM_STEPS`, `derivedFrom` and the fake coverage check are all derived from `STEPS`.

## Tests
- A parametrised test over `STEPS` (label + canned fake reply).
- A contract violation is driven through Fake outputs, not by monkeypatching `analyze_prospectus`.

## Comments

Resolved 2026-10-12 (uncommitted, on `refactor/architecture-deepening`).

- `prospectus.analysis.analyze(prospectus_id, reference, pdf_bytes, deps,
  progress=NO_PROGRESS) -> artifact` is the module's interface.
  `AnalysisDeps(llm: LLMSession, parse_fn, parse_cache: ArtifactStore, now)`;
  `progress` is any `Progress` (`advance(label)`, `heartbeat()`), so the job
  passes its `JobContext`. `analyze` owns parse reuse (`ensure_parse` + the
  heartbeat), routing, every LLM step, and the metadata: routing records,
  `parse`/`timing` (the job no longer mutates the returned artifact),
  provenance and cost. An unparseable PDF is terminal; LLM errors propagate
  for the pipeline to classify.
- One declarative `STEPS: tuple[Step, ...]` (id, label, phase, output model,
  artifact slot, source = routed section | cornerstone | reduce, `feeds_watch`).
  Derived from it: `LLM_STEPS`, `PROGRESS_STEPS` (the job's plan is
  `fetching-prospectus` + `PROGRESS_STEPS`), the reduce's `SECTION_OUTPUTS`, and
  `WATCH_DERIVED_FROM`. Deleted: `analyze_prospectus`, `_PROSPECTUS_STEPS`,
  `_STEP_INDEX` and its assert, the `on_step` callback, `_default_parse_fn` in
  the handler (now `prospectus.job.default_parse_fn`).
- **`derivedFrom` bug: NOT fixed, needs a contract change.** The reduce is fed 6
  outputs (4 sections + lock-up + related-party insights), but
  `ProspectusWatchSection.derivedFrom` in `packages/contracts/src/artifact.ts` is
  a fixed `z.tuple` of the 4 section literals. Listing `lockup`/`relatedParty`
  would fail the pre-write contract check. `derivedFrom` is now derived from
  `STEPS` as "the SECTIONS the reduce read" (still the 4), with a comment and a
  test that pins the 6 fed keys to `feeds_watch`. To fix: widen the tuple
  (or make it an array of an enum) in contracts, regenerate, then derive from
  every `feeds_watch` step.
- The contract pre-write check stays in the job pipeline (ticket 02), not in
  `analyze`, so it runs once for every job.
- Tests: a parametrised test over `STEPS` (label, registry phase, canned fake
  reply validates against the step's output model) and a derivation test.
  The two tests that monkeypatched `analyze_prospectus` are replaced by one
  contract violation driven through the fake (negative token usage breaks the
  cost report), plus the pipeline's own unknown-key test. Analysis, corpus and
  `scripts/live_corpus_run.py` call `analyze()`. Unit lane 199 → 207 passed
  (incl. 9 corpus); integration 2 passed; smoke OK.
- Verified with a throwaway HEAD worktree: the prospectus artifact, `JobResult`
  and progress sequence are byte-identical to before (timestamps masked).

