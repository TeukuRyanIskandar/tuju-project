# Frontend showcase blocker fixes — Navigation Map

**Date:** 2026-10-16
**Scope:** Remediation for the blockers found auditing parent tickets 01-05
**Total tickets:** 16

| Document | Purpose |
| --- | --- |
| [`spec.md`](spec.md) | Scope, sequencing rationale, non-goals, verification |
| [`audit.md`](audit.md) | Evidence, with verified `file:line` citations |
| this file | Dependency graph and status |

## Why this effort exists

Parent tickets 02-05 have uncommitted implementations, and parent ticket 01
cannot be satisfied: **0/3 complete stocks, 0/2 prospectuses.** Two independent
problems must be separated because their risk profiles differ entirely — there is
no demoable data, and the frontend work plus the tracker record need cleanup. See
[`spec.md`](spec.md).

## Overall status

**Track 1's contract and worker halves are done; the frontend half is not.**
The uncommitted working tree still holds all parent-ticket 02-05 implementation;
this effort adds remediation on top of it.

| Track | Tickets | State |
| --- | --- | --- |
| Contract scale | 01-04 | 01, 02, 03 resolved; 04 ready |
| Timestamp conformance | 05 | Ready — its fix is already in the working tree |
| Narration diagnosis | 06-08 | 06 and 07 ready; 08 evidence-gated |
| Execution | 09 | Awaiting operator approval |
| Frontend cleanup | 10-15 | All ready, all unblocked |
| Tracker | 16 | Ready, blocked on the work it describes |

## Dependency graph

```
                    01 contract scale  (needs-info)
                    /   |   |   \
                   /    |   |    \
              02 -----+   |    +---- 05 timestamp conformance
              backend   |   |
                 |      |   +------- 04 frontend scale presentation
              03 worker  |
                    |
06 openrouter diagnostics            10  market provenance honesty
        |                              11  duplicate alert
        07 empty vs malformed          12  stock detail honesty
        |                              13  chart design conformance
        08 narration remedy            14  fixture module boundary
        |                              15  doc drift and dead code
   needs-triage                        |
        |                              |
09 bounded re-run  <-------------------+
   needs-info
   (also needs 05 + operator approval)

16 tracker reconciliation
   blocked by 04, 05, 07, 10-15
```

## Frontier — claimable now, no blockers

| Ticket | Title | Severity | Workspace |
| --- | --- | --- | --- |
| [06](issues/06-openrouter-response-diagnostics.md) | Sanitized response metadata at the OpenRouter boundary | high | `services/ai` |
| [10](issues/10-market-provenance-honesty.md) | Market provenance fallback | high | `apps/frontend` |
| [11](issues/11-analysis-panel-duplicate-alert.md) | Duplicate analysis detail alert | low | `apps/frontend` |
| [12](issues/12-stock-detail-panel-honesty.md) | Stock detail header honesty | medium | `apps/frontend` |
| [13](issues/13-chart-design-conformance.md) | Chart volume colouring | low | `apps/frontend` |
| [14](issues/14-fixture-module-boundary.md) | Fixture module boundary | medium | `apps/frontend` |
| [15](issues/15-doc-drift-and-dead-code.md) | Doc drift and dead code | low | `apps/frontend` |

Tickets 10-15 touch files no other ticket edits, so they can run concurrently with
the contract track and with each other. Ticket
[04](issues/04-frontend-scale-presentation.md) is now unblocked too, but it should
not start until a real `fundamental-analysis-2` artifact exists to verify against —
that is [09](issues/09-bounded-rerun-readiness-reaudit.md), which is
operator-gated.

## Verification record — 2026-10-16, for 01, 02 and 03's core

Full suite run in one pass after all three landed together:

```bash
pnpm --filter contracts build          # OK
pnpm --filter contracts test           # 4 files, 74 passed, 3 skipped
pnpm --filter contracts check          # OK - no contract drift (ADR-0008)
pnpm --filter frontend typecheck       # OK
pnpm --filter frontend test            # 23 files, 336 passed
pnpm --filter frontend build           # OK
pnpm --filter frontend test:e2e        # 6 passed
pnpm --filter backend typecheck        # OK
pnpm --filter backend test             # 42 suites, 443 passed (was 432)
pnpm --filter backend test:int         # 18 suites, 191 passed
uv run --project services/ai pytest    # 212 passed
```

Nothing skipped for a reason other than the three opt-in captured-timestamp tests
in `contracts`, which are gated on an environment variable and belong to ticket
05. No failure or unexplained skip.

## Verification record — 2026-10-16, for 03's remainder

Python-only change, so only the AI lane moved:

```bash
uv run --project services/ai pytest    # 227 passed (was 212)
```

+15 tests. The 7 warnings are pre-existing third-party deprecations
(testcontainers `wait_for_logs`, PyMuPDF's SWIG types). `test_prospectus_job.py`
and `test_job_pipeline.py` did not regress from the [01] model regeneration.

## Track 1 — Contract scale (01-04)

The frontend currently branches on metric id to decide scaling, because the
contract's `unit` carries no scale and the backend uses `'%'` for both fractions
and percentage points. Fixing only the frontend would leave the ambiguity for
every future consumer, so this is contract-first.

| Ticket | Title | Blocked by | Status | Severity |
| --- | --- | --- | --- | --- |
| [01](issues/01-contract-percent-scale.md) | Add explicit scale to `FundamentalMetric` | — | `resolved` | high |
| [02](issues/02-backend-fa-scale-producer.md) | Emit honest scale from the FA producer | 01 | `resolved` | high |
| [03](issues/03-ai-worker-scale-passthrough.md) | Pass scale through worker assembly | 01, 02 | `resolved` | high |
| [04](issues/04-frontend-scale-presentation.md) | Drive presentation off scale, not id | 01 | `ready-for-agent` | high |

**Ticket 01's open question is answered: Option A**, with the caveat the audit
got wrong. `map.md` previously justified it by claiming `readiness.md:55` showed
zero FA analyses; that line's zero is *prospectus* analyses. It reads "FA: 24
pending / 4 failed / **2 facts_only**", so Option A strands 2 local `facts_only`
FA artifacts, which now fail the browser schema and render as "Analysis detail
unavailable". Ticket 09's re-run replaces them. Other environments were never
inspectable.

**Order mattered, and it held.** 01, 02 and 03's core landed together in four
commits, so no window existed in which a FA job could run against a contract the
worker could not satisfy.

**[03](issues/03-ai-worker-scale-passthrough.md) settled the rule [04] must
adopt: `scale` picks the number, the metric's own `unit` stays the suffix.**
[04]'s literal wording forces a `%` onto any metric declared `fraction` even
when its `unit` is not `%`, which would print "1250%" for a fraction measured in
`x`. It also found that the *narrative* had the same leak, worse: grounding
accepted only numbers literally in the facts, so a correct "5.67%" was rejected
while "0.0567%" passed, actively pushing the narrative toward the false
statement. `llm/grounding.py` now adds the whole-unit rendering for a `fraction`
source. [04] should carry the same rule.

**Still true:** the frontend's per-metric-id scaling table at
`components/stocks/analysis-presentation.ts:22-24` is untouched. [04] removes it.
Until it does, the worker headline and the panel agree by construction rather
than by code.

## Track 2 — Timestamp conformance (05)

| Ticket | Title | Blocked by | Status | Severity |
| --- | --- | --- | --- | --- |
| [05](issues/05-artifact-timestamp-conformance.md) | Prove timestamps against real contracts | 01 | `ready-for-agent` | high |

The fix is already in the working tree; the regression tests a toy Pydantic model
instead of the generated TA/FA models whose ISO datetime fields rejected the real
payload. Closes parent ticket 14's first technical criterion.

## Track 3 — Narration diagnosis (06-08)

| Ticket | Title | Blocked by | Status | Severity |
| --- | --- | --- | --- | --- |
| [06](issues/06-openrouter-response-diagnostics.md) | Sanitized response metadata | — | `ready-for-agent` | high |
| [07](issues/07-empty-vs-malformed-reply.md) | Empty vs malformed reply | 06 | `ready-for-agent` | medium |
| [08](issues/08-narration-empty-content-remedy.md) | Resolve the narration cause | 07 | `needs-triage` | high |

06 and 07 are worth doing on their own merits: an accurate terminal reason and
non-discarding transport diagnostics are improvements whether or not a remedy
follows. 08 is a decision tree with four outcomes — **`wontfix` is a legitimate
result** if the evidence shows free-only provider behaviour.

## Track 4 — Execution (09)

| Ticket | Title | Blocked by | Status |
| --- | --- | --- | --- |
| [09](issues/09-bounded-rerun-readiness-reaudit.md) | Bounded re-run and re-audit | 05, 08, operator approval | `needs-info` |

Consumes 49 preserved waiting jobs. Requires explicit operator approval for scope,
model routing and ordering, including where the two prospectus jobs sit. The 9
failed jobs are **not** force-retried.

## Track 5 — Frontend cleanup (10-15)

All unblocked, all independently verifiable, none touching another ticket's files.

| Ticket | Title | Area | Status | Severity |
| --- | --- | --- | --- | --- |
| [10](issues/10-market-provenance-honesty.md) | Provenance fallback says "Real source" for unknown | honesty | `ready-for-agent` | high |
| [11](issues/11-analysis-panel-duplicate-alert.md) | Duplicate `role="alert"` | a11y | `ready-for-agent` | low |
| [12](issues/12-stock-detail-panel-honesty.md) | Unexplained EOD blank; 3x fetch on mismatch | honesty | `ready-for-agent` | medium |
| [13](issues/13-chart-design-conformance.md) | Volume colour vs `DESIGN.md` | design | `ready-for-agent` | low |
| [14](issues/14-fixture-module-boundary.md) | `?raw` fixture import in production src | structure | `ready-for-agent` | medium |
| [15](issues/15-doc-drift-and-dead-code.md) | False `CONTEXT.md` convention; dead code | hygiene | `ready-for-agent` | low |

Ticket 13 also records an explicit **deferral** on shared chart primitives, with
the recommendation to file a separate refactor ticket.

## Track 6 — Tracker reconciliation (16)

| Ticket | Title | Blocked by | Status | Severity |
| --- | --- | --- | --- | --- |
| [16](issues/16-showcase-tracker-reconciliation.md) | Reconcile the showcase tracker | 04, 05, 07, 10-15 | `ready-for-agent` | medium |

Corrects parent ticket 04's false "no analysis requests" claim, writes parent
ticket 03's missing record, and answers parent ticket 02's open completion
question rather than deferring it again.

## Before any commit

```bash
pnpm --filter contracts check        # ADR-0008 drift gate
pnpm --filter contracts test
pnpm --filter frontend typecheck
pnpm --filter frontend test
pnpm --filter frontend build
pnpm --filter frontend test:e2e
pnpm --filter backend test
# AI worker, via services/ai pytest config
```

Commit in separate commits: contracts, backend, AI worker, frontend, tracker.
The working tree also holds unrelated uncommitted backend, AI, docs and OpenCode
changes — **do not sweep them in.**

## What completing this effort does not achieve

The showcase remains **not demonstrable**. Still open:

- [09](issues/09-bounded-rerun-readiness-reaudit.md) execution approval
- Parent tickets 11 (market cold-start) and 13 (news policy), both
  `ready-for-human`
- Private hosting and non-redistribution rights review
- Part-1-only prospectus inputs — absent sections must never be described as
  absent in the issuer's complete prospectus
- Parent tickets 06, 07, 08, 09 (prospectus, discovery, news/a11y, rehearsal)
- No human screen-reader or assistive-technology audit anywhere in this effort