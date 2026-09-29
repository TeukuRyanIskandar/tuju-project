# Deepen the JobBus into the job lifecycle module

Status: needs-triage
Strength: Strong
Dependency category: local-substitutable (Redis via testcontainers)
Implements: ADR-0007 §2 (fan-out), §6 (failure semantics)
Related: 02 (correlation registration happens at enqueue), 03 (jobId identity)

## Files

- `apps/backend/src/jobbus/job-bus.service.ts`: `onModuleInit()` handlers for `'progress'`, `'completed'`, `'failed'`
- `apps/backend/src/analysis/analysis-result.store.ts`: `persist()`, `findByCorrelationId()`
- `apps/backend/src/jobbus/job-bus.int-spec.ts`

## Problem

The JobBus is shallow where it should be deep. Its interface is small, but it only
broadcasts raw BullMQ events and leaves routing to each subscriber.

- **The fan-out from ADR-0007 §2 isn't implemented.** No `jobId → [correlationId]`
  registry exists. When a second request dedupes onto an existing job (same
  content-derived jobId), BullMQ drops the add, so request B's correlationId is
  never recorded. The result carries only request A's correlationId (echoed by the
  worker), so `GET /analysis/:correlationIdB` returns 404 forever. **This is a live
  bug** once the price-move trigger or a double-click happens.
- **Progress events carry no correlationId** (`{ ...progress, jobId }`), so they
  can't be delivered to the waiting client.
- **Failure events are hardcoded:**
  ```ts
  correlationId: '',
  failureClass: 'transient_exhausted',
  retryable: true,
  userMessage: failedReason ?? 'Job failed.',
  ```
  This never reports `terminal`, although the Python worker raises
  `UnrecoverableError` for bad envelopes. It leaks the raw `failedReason` into a
  field the contract says must never be a stack trace, and it drops the
  correlationId.

## Deletion test

There's nothing to delete; the behaviour is missing. Without a home, routing and
failure translation would reappear in every subscriber, and progress and failure
couldn't be routed at all.

## Direction (not an interface design)

The JobBus owns the job lifecycle end to end:

- records each correlationId against its jobId at enqueue
- resolves `jobId → correlationIds` when progress, completed or failed events arrive
- classifies each failure as `terminal` or `transient_exhausted` (using attempts made
  and the unrecoverable signal) and sets `retryable`
- redacts `userMessage` to a safe string
- delivers per-correlation events, so subscribers stop relying on the body-echoed correlationId

Registry storage: an in-memory map fits the single-EC2 box (ADR-0006). A Redis-backed
registry is the multi-instance path ADR-0007 already notes, and a likely second
adapter. Every backend replica receives the same QueueEvents, so double delivery is
the thing to watch.

## Tests

- Extend the testcontainers int-spec with:
  - two enqueues onto one jobId → both correlationIds get a JobResult and both rows are readable
  - poison envelope → `JobFailure{ failureClass: 'terminal', retryable: false }` with the correct correlationId
  - transient failure ×3 → `transient_exhausted`, `retryable: true`
- Unit tests for failure classification and redaction (no infrastructure needed).

## Open questions for grilling

- Should the registry be in-memory now, or go straight to Redis?
- Where should the "unrecoverable" signal be read from (BullMQ `failedReason` shape vs job opts/attempts)?
- Should AnalysisResultStore write one row per correlationId, or one row per jobId plus a join?

## Comments
