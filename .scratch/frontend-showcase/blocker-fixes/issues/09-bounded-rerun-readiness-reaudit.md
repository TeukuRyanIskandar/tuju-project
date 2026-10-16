# 09 — Bounded re-run and readiness re-audit

Type: task
Status: needs-info
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

## Blocking approval gate — this is why the ticket is `needs-info`

Running this consumes **49 preserved waiting jobs** and produces AI cost, even on
`openrouter/free` where cost is bounded but not zero. Required before any run:

1. Explicit operator approval for the run, its scope and its model routing.
2. An agreed resume and ordering plan, including where the two prospectus jobs
   (`094fd734-c812-4bcf-921d-72dea6f21fb6` Insights Analytics Berhad,
   `5a9e9d7f-97e9-4cbf-9126-98965756ef5b` Fibromat (M) Berhad) sit in the order.
3. Confirmation that the 9 failed jobs are **not** force-retried.
4. Confirmation that ingestion stays off, as in the last run.

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