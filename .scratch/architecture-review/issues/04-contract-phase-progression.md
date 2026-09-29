# Contract owns each JobName's phase progression

Status: needs-triage
Strength: Worth exploring
Dependency category: in-process
Implements: ADR-0007 §4 ("Python must emit known phases")

## Files

- `packages/contracts/src/enums.ts`: `TechnicalPhase` / `FundamentalPhase`
- `services/ai/src/tuju_ai/handler.py`: `phases` tuple, literal `"synthesizing-verdict"` / `"persisting-artifact"` / `"done"`, `total = 5`
- `services/ai/src/tuju_ai/contracts_generated/models.py`: `JobProgress.phase` is the union of both enums
- `apps/backend/src/jobbus/stub-job.worker.ts`: emits `stepTotal: 1`
- `services/ai/tests/test_handler.py`: hand-written order assertions

## Problem

Knowledge of which phases belong to a JobName, and in what order, is scattered: the
contract declares the phases, the handler re-types them, and the generated union
type lets a fundamental phase pass validation on a technical job. The stub and the
real worker disagree on `stepTotal`. Drift is caught only by hand-maintained asserts.

## Direction (not an interface design)

The contract publishes the ordered phase sequence per JobName (emitted through the
existing codegen). The worker and stub iterate that sequence, and `stepTotal`
derives from it.

## Why not Strong

The phase set is still a stub until the real LangGraph graph lands (ADR-0007 risk
note). It may be better timed alongside the first real TA graph.

## Tests

Replace the order asserts with "handler emits exactly the contract's sequence for
this JobName" on the Python side.

Note: this ticket's evidence comes from the exploration sub-agent. Re-read the
files before starting.

## Comments
