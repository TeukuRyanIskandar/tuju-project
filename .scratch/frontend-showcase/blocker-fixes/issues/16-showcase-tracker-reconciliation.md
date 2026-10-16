# 16 — Reconcile the showcase tracker with reality

Type: task
Status: ready-for-agent
Blocked by: 04, 05, 07, 10, 11, 12, 13, 14, 15
Severity: medium
Component: `.scratch/frontend-showcase`

## Problem

Parent tickets 02-05 all carry `Status: ready-for-agent` while their
implementation sits uncommitted in the working tree. Ticket 03 has no
implementation record at all. Ticket 04's record contains a claim that is now
false. Anyone resuming this effort cannot tell what is done.

## Evidence

| Parent ticket | Header says | Reality at audit time |
| --- | --- | --- |
| 01 data readiness | `needs-info` | Accurate. Blocked; see [09](09-bounded-rerun-readiness-reaudit.md). |
| 02 contracts and queries | `ready-for-agent` | Substantively implemented and uncommitted. |
| 03 market overview | `ready-for-agent` | Implemented; **no implementation or verification comment exists**. |
| 04 stock header chart | `ready-for-agent` | Implemented; comment present but partly false. |
| 05 analysis panels | `ready-for-agent` | Implemented; comment present. |

Specific defects:

- Parent `../../issues/04-stock-header-chart.md:77` states TA/FA slots were
  "reserved only, with **no analysis requests** or jobs". Now false:
  `apps/frontend/src/components/stocks/stock-detail.tsx:78-79` mounts
  `TechnicalAnalysisPanel` and `FundamentalAnalysisPanel`, which issue reads.
  Parent ticket 05's comment records the replacement; 04's record was never
  corrected.
- Parent 04's verification figures are stale: it claims "5 Chromium tests" and
  "20 files, 282 tests". The tree has 6 (`e2e/smoke.spec.ts` 3,
  `e2e/stock-detail.spec.ts` 3) and 23 test files. Parent 05's later figures
  (6 / 23 / 329) match.
- No showcase work is committed. See the uncommitted inventory in
  [`../audit.md`](../audit.md).
- Both 04 and 05 describe their prerequisite reconciliation of ticket 02 as
  "deliberately unchanged" and "not wholesale certification". Ticket 02's status
  and dependency edges have therefore never been reconciled.

## Root cause

Implementation ran ahead of tracker hygiene, and the work is uncommitted, so
there was no review checkpoint that would have surfaced the drift.

## Work

1. **Ticket 03** — write the missing implementation and verification comment.
   State what was built, what was verified and with which commands, and the
   limits. Do not copy parent ticket 05's figures; run or re-derive them.
2. **Ticket 04** — correct the false "no analysis requests" claim at line 77, and
   either refresh or annotate the stale verification counts. Preserve the original
   record under `## Comments` rather than rewriting history; add a dated
   correction.
3. **Tickets 02, 03, 04, 05** — move each to the status that reflects reality
   using the repo's vocabulary (`docs/agents/triage-labels.md`). Decide explicitly
   whether each is `ready-for-human` (implemented, awaiting human review) or still
   `ready-for-agent` (work remaining). Do not leave them implying unstarted work.
4. **Ticket 02 reconciliation** — resolve it properly rather than as a running
   comment. Either certify its acceptance criteria or record precisely which ones
   are unmet. Its browser schemas, query keys, bounded mismatch reads and
   coherence handling are verified correct in [`../audit.md`](../audit.md); the
   frontend does not own the `prospectusResults` lifecycle yet, which is ticket
   06's work — decide whether that makes 02 incomplete or scoped-to-what-exists.
5. **Dependency edges** — parent 04 blocks on 02 and parent 05 blocks on 02 and
   04. If those dependencies are now satisfied in practice, say so. If they are
   not, say why. Parent 05's own record notes the waiver logic that let it proceed.
6. **Ticket 01** — update with what this effort unblocked, and restate that
   `needs-info` remains correct: tickets 11, 13, the rights review and the
   [09](09-bounded-rerun-readiness-reaudit.md) approval gate are all still open.
7. **Ticket 14** — record the outcomes of [05](05-artifact-timestamp-conformance.md)
   and [07](07-empty-vs-malformed-reply.md). It stays open pending
   [09](09-bounded-rerun-readiness-reaudit.md)'s approval decision.

## Acceptance criteria

- Every parent ticket's `Status:` line matches reality.
- Parent 03 has an implementation record.
- Parent 04 contains no false claim.
- Parent 02's completion question is answered, not deferred again.
- Ticket 01 correctly still reads `needs-info` with named open blockers.
- No comment in any parent ticket claims a verification this effort did not run.

## Verification

Read the five parent tickets plus [`../../readiness.md`](../../readiness.md)
end to end and confirm each status line is defensible from the tree. Cross-check
every `file:line` citation a parent ticket makes after editing it.

## Limits

- This ticket edits **records**, not code. If reconciling a status reveals
  unfinished implementation, file follow-up tickets rather than quietly widening
  scope here.
- Do not mark anything complete that depends on
  [09](09-bounded-rerun-readiness-reaudit.md). The showcase is not demonstrable.
- Preserve superseded content under `## Comments` per
  `docs/agents/issue-tracker.md`. Corrections are appended, not silently
  overwritten.