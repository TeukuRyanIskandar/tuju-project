# One owner for jobId across both worlds

Status: needs-triage
Strength: Strong
Dependency category: in-process
Implements: ADR-0007 §2 (content-derived idempotent jobId)
Related: 02 (enqueue seam is the single minting point)

## Files

- `apps/backend/src/jobbus/job-bus.service.ts`: `deriveJobId()` → `ta-MAYBANK-1D-2026-09-29T05`
- `services/ai/src/tuju_ai/handler.py`: `handle_job()` → `f"{job_prefix}:{symbol}:{anchor_value}:{as_of_bucket}"` → `ta:MAYBANK:1D:2026-09-29T05`
- `services/ai/src/tuju_ai/worker.py`: `process(job, token)` has `job.id` but doesn't use it
- `packages/contracts/fixtures/job-result.json`, `job-failure.json`: colon form
- Tests assert different formats: `job-bus.int-spec.ts` (`/^ta-MAYBANK-1D-/`) vs `test_handler.py` (`startswith("ta:MAYBANK:1D:")`)

## Problem

Idempotency depends on the jobId, but each world derives it independently: different
separators, plus a copy-pasted hour-bucket rule and prefix map. The worker writes its
own version into `JobResult.jobId`, so `analysis_results.job_id` in Postgres **doesn't
match the BullMQ job id**. The golden fixtures encode the colon form, which BullMQ
forbids in custom job ids (see the comment on `deriveJobId`).

## Deletion test

Delete the Python derivation and nothing is lost: the real id is already on the
BullMQ job. That's a clean deletion.

## Direction (not an interface design)

- The backend enqueue seam is the **only** place a jobId is minted.
- The Python JobBus adapter (`worker.py`) passes `job.id` through to the handler or
  stamps it on the result. The handler forgets the id rule. The S3 key currently
  reuses `job_prefix`/`as_of_bucket`, so decide whether the key derives from `job.id`.
- Fix the goldens to the BullMQ-legal form.

## Tests

- Delete the divergent format assertions on both sides.
- Python: the handler returns whatever jobId it was given.
- Backend int-spec: persisted `job_id` equals the id returned by `enqueue`.

## Comments
