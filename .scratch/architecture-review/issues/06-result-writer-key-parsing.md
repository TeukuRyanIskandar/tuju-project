# Stop the result writer parsing the claim-check key

Status: needs-triage
Strength: Speculative
Dependency category: in-process
Blocked by: 01, 02
Touches: ADR-0004 (artifact opaque), ADR-0007 §5 (thin summary)

## Files

- `apps/backend/src/analysis/analysis-result.store.ts`: `symbolFromKey()` returns `key.split('/')[2]`, or `'unknown'` if the key has fewer than three segments
- `services/ai/src/tuju_ai/handler.py`: `key_suffix = f"{job_prefix}/{symbol}/{as_of_bucket}.json"`
- `services/ai/src/tuju_ai/artifacts.py`

## Problem

The Postgres writer reverse-engineers the symbol from the S3 key layout, which is
defined in Python. This leaks across the language seam through an untyped string.
If the key scheme changes, every persisted `symbol` silently becomes `'unknown'`.

## Direction (not an interface design)

The writer should take the symbol from what the backend already knows about the
job: once 01 and 02 land, the JobBus knows the enqueued payload for each jobId. The
pointer key then becomes opaque again and `symbolFromKey` is deleted.

## ADR note

The alternative, adding `symbol` to `Summary` or `JobResult`, touches ADR-0007's
"thin summary". It's small and additive, but it would reopen the contract. Prefer
sourcing the symbol from the enqueued job.

## Comments
