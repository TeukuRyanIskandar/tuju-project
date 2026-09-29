# Architecture review 2026-09-29: deepening opportunities

Status: needs-triage

Output of an `/improve-codebase-architecture` pass over the recent hot spots from
`git log` (scaffold tickets 02–07): `apps/backend/src/jobbus`, `apps/backend/src/analysis`,
`apps/backend/src/auth`, `packages/contracts`, `services/ai/src/tuju_ai`.

ADR-0001–0011 were treated as settled. Almost every finding is a gap where code
only partially implements an ADR, not a reason to revisit one.

Vocabulary follows the `codebase-design` skill (module, interface, implementation,
depth, seam, adapter, leverage, locality) and each context's `CONTEXT.md`.

Visual report (before/after diagrams): [`report.html`](report.html).

## Candidates

| #  | Ticket                                                                 | Strength        | Dependency category  |
| -- | ---------------------------------------------------------------------- | --------------- | -------------------- |
| 01 | [Deepen the JobBus into the job lifecycle module](issues/01-jobbus-lifecycle-module.md) | Strong          | local-substitutable  |
| 02 | [Make the Enqueue seam own the enqueue](issues/02-enqueue-seam.md)     | Strong          | in-process           |
| 03 | [One owner for jobId across both worlds](issues/03-single-job-identity.md) | Strong          | in-process           |
| 04 | [Contract owns each JobName's phase progression](issues/04-contract-phase-progression.md) | Worth exploring | in-process           |
| 05 | [Generate queue/JobName constants into Python](issues/05-generate-python-name-constants.md) | Worth exploring | in-process           |
| 06 | [Stop the result writer parsing the claim-check key](issues/06-result-writer-key-parsing.md) | Speculative     | in-process           |

## Top recommendation

**01 first.** It fixes a live correctness bug (a request that dedupes onto an
existing job never gets its result) and closes the largest ADR-0007 gap. 02, 03
and 06 all land on the same seam, so 01 is the natural anchor.

## Next step for each ticket

None of these has a designed interface yet. Before implementing, run a grilling
pass (constraints, what sits behind the seam, which tests survive), and use the
`codebase-design` design-it-twice pattern if the interface shape is contested.
Move a ticket to `ready-for-agent` only after that.

## Current call flow (as wired at time of review)

```
FE POST /analysis
  → AuthGuard (session from Redis)  → TierGuard (@RequiresJob → can())
  → AnalysisController.enqueue       hand-builds JobEnvelope (correlationId = req.id)
  → JobBus.enqueue                   deriveJobId → queue.add (attempts 3, 5s fixed, retention)
  → Redis 'analysis' queue
  → tuju_ai worker.process → handler.handle_job
        validate → progress ×6 → graph stub → S3 put → JobResult (re-derived jobId)
  → JobBus QueueEvents 'completed' → broadcast
  → AnalysisResultStore.persist → Postgres
FE GET /analysis/:correlationId → store.findByCorrelationId
```

Progress and failure events are broadcast, but nothing subscribes to them yet.
