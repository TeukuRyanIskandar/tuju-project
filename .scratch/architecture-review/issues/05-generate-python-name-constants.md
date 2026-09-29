# Generate queue/JobName constants into the Python world

Status: needs-triage
Strength: Worth exploring
Dependency category: in-process
Implements: ADR-0002 / ADR-0008 (contracts as the single source, drift gate)

## Files

- `services/ai/src/tuju_ai/config.py`: `QUEUE_ANALYSIS`, `JOB_ANALYZE_TECHNICAL`, `JOB_ANALYZE_FUNDAMENTAL` (kept in sync with `enums.ts` by a code comment)
- `apps/backend/src/jobbus/job-names.ts`: `ANALYSIS_QUEUE`, `JobNames`
- `packages/contracts/scripts/generate.mjs`, `check.mjs`

## Problem

The queue name and JobName strings reach Python only through a code comment. A
rename in `enums.ts` would break the worker silently. Neither the drift gate nor
the golden fixtures cover these strings. `ANALYSIS_QUEUE` is also defined outside
the contract on the TS side.

## Direction (not an interface design)

Extend `generate.mjs` to emit these constants alongside the Pydantic models, so
`check.mjs` (the drift gate) covers them. `config.py` imports the generated
constants instead of redefining them. Consider bringing the queue name into the
contract as well.

Optional: the FE `TIER_JOBS` presentation mirror (`apps/frontend/src/lib/auth.ts`)
could be generated the same way. ADR-0005 sanctions the mirror, so this is
convenience only.

## Tests

Drift gate plus a Python conformance assert that the constants match the generated ones.

Note: this ticket's evidence comes from the exploration sub-agent. Re-read the
files before starting.

## Comments
