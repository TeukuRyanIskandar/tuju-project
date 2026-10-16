# 01 — Audit showcase data readiness and select examples

Status: needs-info
Type: task
Blocked by: none

## Goal

Verify the deployed data supports [the spec](../spec.md), rather than assuming
implemented endpoints imply populated, current and consistently sourced panels.

## Work

- Obtain operator-provided target environment/access. Audit market indices,
  history, movers, sectors; stock core/series/TA/FA/artifacts/news; IPO summaries
  and artifacts. Record dates, provenance, coverage and errors, without secrets.
- Verify market panels coexist with the KLCI real-data pipeline; identify synthetic
  analogues, empty boards and source mismatches explicitly.
- Select target three stocks/two prospectuses with stable IDs. Require at least
  one complete stock and one prospectus, documenting any shortfall.
- Record preparation commands/prerequisites from existing ops docs; do not execute
  paid jobs, destructive resets or deploy changes without approval.
- Create scoped gap issues if BE/data fixes are required. Confirm private hosting
  and non-redistribution limitations with the operator.

## Acceptance criteria

- Given environment access, endpoint evidence and selected IDs are recorded in
  `../readiness.md`, including actual dates/source classes and remaining blockers.
- Given missing data, the record states unavailable rather than supplying mocks.
- Every selected stock has readable EOD series, TA/FA envelopes and coherent rich
  artifacts; every selected prospectus has summary and artifact.
- Market timestamp limitations are recorded; no live/official claims unsupported
  by contracts are approved.

## Verification

Read-only API audit and operator review. This ticket needs environment/access
information before it can be marked ready-for-agent.

## Comments

### 2026-10-15 — Local target selected; runtime unavailable

Operator selected the existing local stack. Read-only inspection found no Tuju
Compose containers/services or API listener; `localhost:3000/health` refused the
connection. Another project's services occupy Tuju's default Postgres/Redis host
ports. No services were started/stopped and no preparation jobs were executed.

Evidence, endpoint checklist, preparation prerequisites and remaining operator
decisions are recorded in [`../readiness.md`](../readiness.md). Status remains
`needs-info` pending an approved isolated startup approach and reachable API.
No examples are selected and deployed data readiness is not yet verified.

### 2026-10-15 — Local API started; empty-data blocker confirmed

After the operator stopped conflicting containers, built and started only Tuju
Postgres, Redis, LocalStack and backend. Boot migrations ran; both workers remain
off. Health is HTTP 200. Market boards, discovery and news reads are empty;
core/series/TA/FA/artifact probes for three KLCI candidate codes return 404.
Read-only database counts confirm zero stock, index, IPO, analysis and ingestion
rows. No actual index/prospectus IDs exist to audit history or prospectus content.

Updated [`../readiness.md`](../readiness.md) with timestamped evidence, image
identity and explicit 0/3 stock, 0/2 prospectus shortfalls. Created scoped
[ticket 10](10-local-data-preparation.md) for operator-approved data preparation
and re-audit. Minimum acceptance is not met, so this ticket remains `needs-info`.
No ingestion, analysis jobs, reset or purge was performed.

### 2026-10-15 — Approved raw data preparation and follow-up audit

Local raw preparation is now executed (superseding the earlier no-ingestion
record): 21,859 real stock bars, 173 quarterly rows, 30 materialised stock
snapshots, 5 synthetic index histories and 3 curated prospectus inputs. Three
stock candidates have real two-year series but pending TA/FA; all curated
prospectus summaries/artifacts are still 404. No complete examples selected.

`../readiness.md` records dates, source mismatches and actual candidate IDs.
Confirmed market cold-cache/mixed-price and generated-news gaps have scoped
tickets 11 and 13; ticket 12 covers a bootstrap hook permission issue recovered
locally. A small Yahoo end-date compatibility fix passed all 432 backend tests,
typecheck and Docker build. Workers remain off with 115 waiting jobs; no AI
calls have run. Status remains `needs-info` for generation approval, coherent
artifact verification and market/news readiness decisions.

### 2026-10-15 — Approved free-model execution; incomplete at 06:57 UTC

Explicit approval covered all 115 jobs and two prospectuses, `openrouter/free`
only. Built/started only AI, verified PDFs/IDs and enqueued Insights Analytics
`094fd734-c812-4bcf-921d-72dea6f21fb6` and Fibromat
`5a9e9d7f-97e9-4cbf-9126-98965756ef5b`. Stopped AI cleanly after approximately
14 minutes of persistent invalid narration outputs; no paid fallback/force/reset.
Final queue: 59 completed (55 announcements + 4 facts-only TA/FA), 9 failed,
49 waiting (including both prospectuses), 0 active/delayed. Ingestion stayed off.

API audit: 1155 TA/FA pending; 1023 TA/FA failed; 5326 TA facts_only, FA failed.
All stock series remain readable, but no complete stock exists. 5326 TA artifact
matches symbol/jobName/time instant and honest withheld-narrative label, yet
fails ISO datetime contracts on asOf/generatedAt, reproduced on re-read. Both
prospectus summary/artifact pairs remain 404; no generation coherence can be
claimed. **0/3 complete stocks, 0/2 prospectuses; minimum unmet.** Ticket 14
records generation/serialization blockers. Latest sanitized commands, dates and
errors are at the top of `../readiness.md`. Tickets 11/13 and rights review remain
outstanding. Status remains `needs-info`; execution approval is no longer missing.

### 2026-10-16 — Blockers audited; remediation moved to `../blocker-fixes/`

An audit of tickets 01-05 confirmed the `0/3` and `0/2` shortfalls are unchanged
and traced them to two technical causes: artifact timestamps failing their own
ISO contract (the only non-404 artifact, TA for 5326), and unusable `narrate`
output from free-only routing. Both are recorded with `file:line` evidence in
[`../blocker-fixes/audit.md`](../blocker-fixes/audit.md).

Remediation is tracked in [`../blocker-fixes/`](../blocker-fixes/map.md), which is
the single source of truth for the work: **this ticket remains `needs-info`** and
still owns acceptance. Its blockers are now named precisely — blocker-fix tickets
[05](../blocker-fixes/issues/05-artifact-timestamp-conformance.md),
[08](../blocker-fixes/issues/08-narration-empty-content-remedy.md) and
[09](../blocker-fixes/issues/09-bounded-rerun-readiness-reaudit.md), plus parent
tickets 11, 13, the rights review and the Part-1-only prospectus inputs. No data
changed and no generation ran during the audit.

### 2026-10-16 — Reconciliation: bounded canary met the minimum execution milestone

Blocker-fixes ticket 09 subsequently ran an approved, fresh three-job canary.
MAYBANK (`1155`) now has coherent `ready` TA and FA artifacts, and Insights
Analytics Berhad (`094fd734-c812-4bcf-921d-72dea6f21fb6`) has a summary and
artifact that passed the recorded contracts. The timestamped evidence is in
[`../readiness.md`](../readiness.md#fresh-three-job-ai-canary--2026-10-16-08420846-utc).

This is a historical execution result, not a claim about the runtime state after
2026-10-16. Status remains `needs-info`: the target is three stocks and two
prospectuses; parent tickets 11 and 13 still need human policy decisions; private
hosting/non-redistribution rights and final example selection remain operator
work; and the prospectus input is Part 1 only. Blocker-fixes 05, 08 and 09 are
no longer open technical or execution gates.
