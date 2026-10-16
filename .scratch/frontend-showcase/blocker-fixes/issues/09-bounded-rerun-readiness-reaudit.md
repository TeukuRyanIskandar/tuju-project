# 09 — Bounded re-run and readiness re-audit

Type: task
Status: resolved
Blocked by: 05, 08, operator approval
Severity: high
Component: operations

## Problem

Even with every technical ticket in this effort complete, there is still no
complete stock and no prospectus. This ticket is the execution step that could
change that, and the decision about whether to run it at all.

## Evidence

Current state, `../../readiness.md`:

- 1155 pending / pending, both artifacts 404 (`:68`)
- 1023 failed / failed, both artifacts 404 (`:69`)
- 5326 facts_only / failed, TA artifact present but contract-invalid (`:70-88`)

Queue at `06:56:41Z`: 59 completed, 9 failed, 49 waiting, 0 active, 0 delayed.
Waiting includes 23 TA, 24 FA and both prospectuses (`:40-44`). Both resident
workers are off.

Persistence counts from `:96-101`: 1155 TA/FA pending, 1023 failed, 5326 TA
facts_only with 5326 FA failed.

## Root cause

Not a defect. This is an operations decision about consuming queue state that was
deliberately preserved.

## Approval gate — satisfied before the run

At the initial audit, the queue contained **49 waiting jobs**. The original plan
would have consumed that preserved queue and incurred AI cost, even on
`openrouter/free` where cost is bounded but not zero. The following approvals
were required before execution:

1. Explicit operator approval for the run, its scope and its model routing.
2. An agreed resume and ordering plan, including where the two prospectus jobs
   (`094fd734-c812-4bcf-921d-72dea6f21fb6` Insights Analytics Berhad,
   `5a9e9d7f-97e9-4cbf-9126-98965756ef5b` Fibromat (M) Berhad) sit in the order.
3. Confirmation that the 9 failed jobs are **not** force-retried.
4. Confirmation that ingestion stays off, as in the last run.

### 2026-10-16 — Operator approval and bounded execution plan

Operator approved a staged, three-job canary in this conversation:

- **Scope/order:** 1155 technical analysis, 1155 fundamental analysis, then
  Insights Analytics Berhad prospectus
  (`094fd734-c812-4bcf-921d-72dea6f21fb6`). Stop between stages if any acceptance
  gate fails. Fibromat and all other queued/failed jobs are excluded.
- **Routing:** temporary `google/gemini-2.5-flash` process-level override; do not
  alter the shipping default.
- **Aggregate ceiling:** at most 20 provider calls and $1.00 total spend. This
  must be enforced across the run before any call; existing per-job ceilings alone
  do not enforce it. Record actual calls, tokens and spend in
  `.scratch/llm-usage.md`.
- **Runtime:** rebuild/recreate the backend API and AI worker from the current
  tree as needed. Keep ingestion stopped. Preserve Postgres, Redis, queue state
  and existing artifacts; restart infrastructure only for a demonstrated
  health issue. Capture the selected jobs' initial state and artifact pointers.
- **Execution gate:** the normal AI worker continuously consumes the `analysis`
  queue and has no job-count or stock filter. Do not start it until a
  BullMQ-supported execution path is verified to process only these three jobs,
  sequentially, while preserving lock renewal and backend result persistence,
  leaving unrelated jobs untouched, and enforcing the aggregate call/spend
  ceiling. If that cannot be established without an application change, stop and
  report the prerequisite; do not approximate with timed worker shutdown.
- **Safety:** ingestion remains off; the 9 previously failed jobs are not
  force-retried. Do not purge/reset queue, database volumes or artifacts.

### 2026-10-16 — Preflight stopped at queue isolation gate

Read-only runtime inspection found the stack state is still the historical one:
backend API healthy, Postgres/Redis/LocalStack healthy, AI worker exited, and no
ingestion-worker container. A fresh BullMQ read confirms 49 waiting, 0 active,
0 delayed, 59 completed and 9 failed. The selected jobs are already waiting:
`ta-1155-1D-2026-10-15T04`, `fa-1155-quarterly-2026-10-15T04`, and
`prospectus-094fd734-c812-4bcf-921d-72dea6f21fb6`. The other prospectus job and
all unrelated waiting/failed jobs remain untouched.

Execution did not start. The shipped Python BullMQ worker continuously claims
the next queue job; it has no allowlist or max-job option. Starting it would take
unrelated jobs ahead of 1155. A verified, fail-closed execution path is therefore
still required before rebuilding/restarting or making any LLM call. No service
was restarted, no queue state was changed, no provider call was made, and no
artifact/database write occurred. This also means no usage entry is due in
`.scratch/llm-usage.md`.

Next step: agree whether to extend ticket 09's operations-only scope with a
temporary, verified one-shot queue runner, or implement a supported bounded-run
mechanism as a separate code change. After that path is verified, repeat the
baseline (the queue can change) before proceeding with the approved envelope.

### 2026-10-16 — Operator authorizes fresh dev/test queue

The operator clarified that this is a dev/test environment and approved replacing
the old queue rather than isolating old waiting jobs. This supersedes the earlier
preserve-queue and no-force-retry constraints above for the **BullMQ analysis
queue only**:

- Stop AI and ingestion workers; purge the `analysis` queue, including the 49
  waiting, 9 failed and 59 retained completed records observed at preflight.
- Preserve Postgres and LocalStack volumes and all prepared source data/artifacts.
- Rebuild/recreate the backend API and AI worker from the current tree, leaving
  ingestion stopped.
- Enqueue only fresh jobs for 1155 TA, 1155 FA, then Insights Analytics
  (`094fd734-c812-4bcf-921d-72dea6f21fb6`). Keep a verification gate between
  stages and stop on any failed acceptance check.
- Retain the approved temporary `google/gemini-2.5-flash` route and aggregate
  ceiling of 20 calls / $1.00. Enforce the ceiling using per-job caps whose sum is
  no greater than $1.00 and the existing bounded paid retry behavior; verify the
  configured job-step/retry counts before enqueueing.
- Do not start AI processing until the queue is confirmed empty, then contains
  only the three approved fresh jobs. No prospectus force-retry or broad enqueue.

## Prerequisites — all must be true before starting

- [05](05-artifact-timestamp-conformance.md) complete: stored artifacts must pass
  the real contracts, or the run reproduces the invalid-timestamp result.
- [03](03-ai-worker-scale-passthrough.md) complete: without it every FA job fails
  terminally on a missing `scale` and burns attempts for no diagnostic value.
- [08](08-narration-empty-content-remedy.md) resolved, including the `wontfix`
  case — if the outcome is `wontfix`, decide with the operator whether a
  `facts_only`-only showcase is acceptable.
- Backend, Postgres, Redis and LocalStack healthy; API `/health` 200.
- Analyst knows the artifact bucket is reachable and [ticket
  12](../../issues/12-localstack-bucket-bootstrap.md)'s bootstrap concern is not a
  fresh blocker.

## Work

1. Record approval, scope, model routing and the ordering plan under `## Comments`
   before starting anything.
2. Rebuild the AI worker from the current tree. Do not restart ingestion.
3. Run the approved scope. Monitor with read-only BullMQ counts and sanitized log
   aggregation, not process exit status — the previous run took roughly 14 minutes
   and exited 0 while producing nothing usable.
4. Stop cleanly if the diagnosed failure mode reappears. Do not let it run to
   exhaustion.
5. Re-audit via the API: stock core, `series?interval=1d&range=2y`, both
   analysis envelopes and both artifacts for each candidate; both prospectus
   summary and artifact pairs.
6. Validate every artifact against the real contracts, and validate the
   proxied cost-stripped shape for at least one, the way `../../readiness.md:83-87`
   did.
7. Update [`../../readiness.md`](../../readiness.md) with timestamped evidence.

## Acceptance criteria

- At least one complete stock with readable EOD series, a TA envelope plus a
  contract-valid artifact, and an FA equivalent — **or** an honest record of the
  remaining shortfall with evidence.
- At least one prospectus with summary and artifact — or the same honest record.
- Narrative is genuine model prose, not a facts-only placeholder presented as
  narration. If it is `facts_only`, say so plainly and treat the stock as
  incomplete.
- Actual dates, source classes, provenance and coverage recorded. No mocks.
- Part-1-only prospectus inputs stay visible as a limitation (`../../readiness.md:97-99`).

## Verification

Read-only API audit plus direct contract validation. Operations-only pass — this
ticket changes no application code.

## Limits

- Tickets 11 (market cold-start) and 13 (news source policy) are `ready-for-human`
  and are **not** resolved by this ticket. Market and news panels stay limited.
- Private hosting and non-redistribution rights review remains an operator
  prerequisite.
- Even success here does not complete the showcase: tickets 06, 07, 08 and 09 of
  the parent effort remain, and no human screen-reader audit has been done.

## Answer

Resolved 2026-10-16 after the operator approved a fresh dev/test analysis queue.
The prior analysis queue was purged with zero active jobs/workers; Postgres and
LocalStack volumes were preserved. Backend and AI images were rebuilt; the
backend was recreated and healthy. Ingestion remained off. Enqueueing and
processing were staged so the queue contained one approved job at each gate.

| Stage | Job | Result | Calls / estimated spend |
| --- | --- | --- | --- |
| 1155 TA | `ta-1155-1D-2026-10-16T08` | `ready`; fresh stored artifact and cost-stripped API artifact passed generated Pydantic and browser Zod contracts; grounded non-placeholder narration | 2 / `$0.001897` |
| 1155 FA | `fa-1155-quarterly-2026-10-16T08` | `ready`; fresh stored artifact and cost-stripped API artifact passed generated Pydantic and browser Zod contracts; grounded non-placeholder narration; all 9 metric scales present | 1 / `$0.000664` |
| Insights Analytics Berhad | `prospectus-094fd734-c812-4bcf-921d-72dea6f21fb6` | At-a-glance summary and stored artifact passed Pydantic/Zod contracts; artifact headline non-empty | 7 / `$0.016699` |

The stock core passed its HTTP schema with `real` provenance. Its 2-year daily
series passed the contract with **490 real-provenance points** from 2024-10-15
through 2026-10-15. Both TA/FA provenance records identify the `yfinance` adapter
and `google/gemini-2.5-flash`.

The prospectus provenance is `real`; the stored PDF was parsed during this run.
**It is Part 1 only.** The successful result does not establish that material not
located in the supplied part is absent from the complete prospectus. The
related-party section, in particular, was not located in this input.

Approved limit: 20 provider calls / `$1.00`. Actual: **10 calls**, **37,010
prompt tokens**, **3,263 completion tokens**, **$0.019260 local tracker estimate**;
provider billing and reasoning-token counts were not captured. Temporary
per-job ceilings totalled `$0.90` (`$0.05` per TA/FA narration and `$0.80` for
the prospectus). Sanitized usage is recorded in [the ledger](../../../llm-usage.md).

Final analysis queue: 3 completed, 0 waiting, 0 active, 0 delayed, 0 failed; no
AI or ingestion worker remains running. The other prospectus, unrelated waiting
jobs and historical failed jobs were not processed after the approved queue
reset. Readiness evidence is recorded in
[`../../readiness.md`](../../readiness.md#fresh-three-job-ai-canary--2026-10-16-08420846-utc).

This meets ticket 09's minimum execution criterion of one complete stock and one
prospectus result. It does not make the showcase fully demonstrable: broader
coverage, parent tickets 11/13 human reviews, rights review and other readiness
gaps remain open.
