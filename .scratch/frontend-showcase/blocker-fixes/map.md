# Frontend showcase blocker fixes — Navigation Map

**Date:** 2026-10-16
**Scope:** Remediation for the blockers found auditing parent tickets 01-05
**Total tickets:** 19

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

**Track 1 is done on all four tickets — contract, backend, worker and frontend.**
The original audit snapshot preceded checkpoint and remediation commits. Parent
tickets 02-05 now have reconciled implementation records; this effort records
their current acceptance state without treating historical working-tree evidence
as the current state.

| Track | Tickets | State |
| --- | --- | --- |
| Contract scale | 01-04 | All four resolved |
| Timestamp conformance | 05 | Resolved |
| Narration diagnosis | 06-08, 17-19 | 06, 07, 08, 17 and 19 resolved; 18 is marked `done`; free-route reliability remains a human product decision |
| Execution | 09 | Resolved: fresh 1155 TA/FA + Insights Analytics canary |
| Frontend cleanup | 10-15 | All six tickets resolved |
| Tracker | 16 | Resolved: parent records reconciled |

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
 07 empty vs malformed                12  stock detail honesty
         |                              13  chart design conformance
 08 narration remedy                  14  fixture module boundary
   RESOLVED (Outcome A)                 15  doc drift and dead code
         |
  17 free-route verification            16  tracker reconciliation
    RESOLVED (found 18, 19)              RESOLVED
          |
   18 grounding rejects truth
     DONE (offline fix + regressions)
          |
  19 reasoning token budget
    RESOLVED (4096 cap; free routing remains variable)
         |
  09 bounded re-run
    RESOLVED (3 fresh jobs; one complete stock + one prospectus)
```

## Frontier — reconciliation complete

No blocker-fix tickets remain open.

Tickets [08](issues/08-narration-empty-content-remedy.md),
[17](issues/17-free-route-narration-verification.md) and
[19](issues/19-free-route-reasoning-token-budget.md) are resolved; [18](issues/18-grounding-rejects-grounded-narrative.md)
is marked `done` in its own record. Tickets 11 and 13 landed in one round and
both passed human review on 2026-10-16. Ticket 09 has since supplied the live
artifact canary that was previously pending.

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

## Verification record — 2026-10-16, for 05

One test file changed in `packages/contracts`; no published type moved, so the
`check` drift gate and the contracts suite are the only contract-side gates
that can have moved. `spec.md`'s full cross-workspace suite was narrowed to the
affected lanes by explicit decision.

```bash
pnpm --filter contracts check          # OK - no contract drift
pnpm --filter contracts test           # 4 files, 74 passed, 3 skipped
uv run --project services/ai pytest    # 227 passed - identical to the 03 baseline
```

The 3 skips are the opt-in captured-bytes tests in `contracts`, gated on
`TUJU_TA_FA_CAPTURE_DIR` / `TUJU_PROSPECTUS_CAPTURE_DIR`. They are not dead
weight: the AI suite's two capture tests set those vars and drive them, which is
how [05] verifies the browser shape. The AI suite's warnings are all
pre-existing — `PytestUnknownMarkWarning` on the unregistered `unit` /
`integration` marks, plus PyMuPDF SWIG deprecations.

**[05] proved the regression bites.** With `jobs/pipeline.py` reverted to
`put_artifact(output.artifact_key, output.artifact)`, the TA/FA captured-bytes
regression and the toy-model regression both fail; restoring the file
(sha256-verified) returns them to green. The **prospectus** captured-bytes
regression passes either way, because `prospectus/analysis.py:471` pre-writes
`isoformat()` — the prospectus path never had the defect. Details and the
second-serialization-path finding are in
[05](issues/05-artifact-timestamp-conformance.md).

## Verification record — 2026-10-16, for 04

Frontend-only change, so the lane was narrowed the same way 05's was. No
contract, backend or worker file moved; no published type changed.

```bash
pnpm --filter frontend typecheck   # OK
pnpm --filter frontend test        # 23 files, 351 passed (was 336)
pnpm --filter frontend build       # OK
pnpm --filter frontend test:e2e    # 6 passed
TZ=America/Los_Angeles pnpm --filter frontend test   # 23 files, 351 passed
TZ=Pacific/Kiritimati  pnpm --filter frontend test   # 23 files, 351 passed
```

+15 tests, no skips. The timezone pair is 04's own Limit: date handling shares
`analysis-presentation.ts`.

**Revert proof.** With `analysis-presentation.ts` restored from `HEAD` and the new
tests kept, exactly **11 fail** — the panel case, the `x` + `fraction` row, and
one per-id guard case for all nine ids. The guard is per-id precisely so a
reinstated id branch fails on the id it special-cased.

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
| [04](issues/04-frontend-scale-presentation.md) | Drive presentation off scale, not id | 01 | `resolved` | high |

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
source. [04] carries the same rule.

**[04] landed 2026-10-16 and took the rule literally: `fraction` gets ×100 for
any unit, `unit` supplies only the suffix.** That is a conscious choice, not an
oversight — gating the conversion on `unit === '%'` would make this panel and
the worker's headline disagree for a `fraction` whose unit is not `%`, which is
the drift the whole track removed. The per-metric-id table at
`components/stocks/analysis-presentation.ts:22-24` is gone, replaced by a rule
that reads `scale` and `unit` and a guard that fails per id if an id-based branch
ever returns. The headline and the panel now agree by code.

## Track 2 — Timestamp conformance (05)

| Ticket | Title | Blocked by | Status | Severity |
| --- | --- | --- | --- | --- |
| [05](issues/05-artifact-timestamp-conformance.md) | Prove timestamps against real contracts | 01 | `resolved` | high |

The fix and the real-model regression were both already committed by the time
this ticket was written — `c181bd2` (ticket 03) landed the regression that
tickets 05 and the audit both recorded as missing. What [05] added was the
cost-stripped **browser** schema assertion against the captured stored bytes,
plus the revert proof. Closes parent ticket 14's first technical criterion.

## Track 3 — Narration diagnosis (06-08)

| Ticket | Title | Blocked by | Status | Severity |
| --- | --- | --- | --- | --- |
| [06](issues/06-openrouter-response-diagnostics.md) | Sanitized response metadata | — | `resolved` | high |
| [07](issues/07-empty-vs-malformed-reply.md) | Empty vs malformed reply | 06 | `resolved` | medium |
| [08](issues/08-narration-empty-content-remedy.md) | Resolve the narration cause | 07 | `resolved` (Outcome A: token exhaustion) | high |
| [17](issues/17-free-route-narration-verification.md) | Verify the remedy on the free route | — | `resolved` (found 18, 19) | high |
| [18](issues/18-grounding-rejects-grounded-narrative.md) | Grounding rejects true narratives | — | `done` | high |
| [19](issues/19-free-route-reasoning-token-budget.md) | Free-route reasoning budget still short | — | `resolved` | high |

06 and 07 are worth doing on their own merits: an accurate terminal reason and
non-discarding transport diagnostics are improvements whether or not a remedy
follows.

**08 resolved as Outcome A — token exhaustion.** A bounded probe on
`openrouter/free` (live 1155 reference, production request builder, 300 tokens)
returned `finish_reason=length`, `completion_tokens=300`, empty content and
reasoning present (893 chars) from `poolside/laguna-s-2.1:free` — the §1a
prediction, measured rather than inferred. Remedy raised `NARRATE_MAX_TOKENS`
to 1024. `wontfix` was **not** required: the free router can be given more
budget.

**But 08's remedy turned out to be necessary and not sufficient.**
[17](issues/17-free-route-narration-verification.md) ran the two planned probes
and found two more defects, both of which independently prevent narration:

- **[18](issues/18-grounding-rejects-grounded-narrative.md)** — the grounding
  check rejects **true** statements. `_source_numbers` harvests numeric values
  only, never dict keys or label strings, so `p20`/`p50`/`p200`/`week52` and
  `"SMA-20 crossed above SMA-50"` contribute nothing and a correct narrative
  saying "the 20-day SMA of 10.0555" is refused. It also has no rounding
  tolerance, so a faithful `18.9%` rendering of a stored
  `pctFromHigh = -18.90145395799678` is refused. This explains the 4
  `facts_only` landings in `readiness.md`, which were never token exhaustion.
- **[19](issues/19-free-route-reasoning-token-budget.md)** — 1024 is still too
  small for the free route: 3 of 4 attempts exhausted it in reasoning, and one
  attempt reported `completion_tokens=2074` against `max_tokens=1024`, so the
  provider's reported completion count appears to include reasoning the cap does
  not bound. Any new budget must be chosen from measurement, not assumption.

18 and 19 are both offline-first. 18 needs no provider at all; 19 needs a
two-cap measurement. **Neither is [09](issues/09-bounded-rerun-readiness-reaudit.md)
approval** — but 09 should not be requested until both are resolved, because
nothing has yet produced a grounded narrative through the free route.

### Verification record — 2026-10-16, for 07

```bash
uv run --project services/ai pytest    # 246 passed
```

Ticket 07 now reports empty, unparseable and schema-invalid replies distinctly,
with ticket 06's allowlisted metadata only. Empty narration remains terminal;
it never enters TA/FA facts-only degradation. The 25 warnings are pre-existing
pytest-marker and third-party deprecations.

## Track 4 — Execution (09)

| Ticket | Title | Blocked by | Status |
| --- | --- | --- | --- |
| [09](issues/09-bounded-rerun-readiness-reaudit.md) | Bounded re-run and re-audit | 05, 08, 18, 19, operator approval | `resolved` |

Purged the old dev/test queue after operator approval, preserving Postgres and
LocalStack volumes. Rebuilt/recreated backend and AI images; ran only fresh 1155
TA, 1155 FA and Insights Analytics prospectus jobs in sequence. All passed
contract and readiness checks. See [the ticket's answer](issues/09-bounded-rerun-readiness-reaudit.md)
and the [timestamped readiness record](../readiness.md#fresh-three-job-ai-canary--2026-10-16-08420846-utc).

## Track 5 — Frontend cleanup (10-15)

All unblocked, all independently verifiable, none touching another ticket's files.

| Ticket | Title | Area | Status | Severity |
| --- | --- | --- | --- | --- |
| [10](issues/10-market-provenance-honesty.md) | Provenance fallback says "Real source" for unknown | honesty | `resolved` | high |
| [11](issues/11-analysis-panel-duplicate-alert.md) | Duplicate `role="alert"` | a11y | `resolved` | low |
| [12](issues/12-stock-detail-panel-honesty.md) | Stock detail header honesty | honesty | `resolved` | medium |
| [13](issues/13-chart-design-conformance.md) | Volume colour vs `DESIGN.md` | design | `resolved` | low |
| [14](issues/14-fixture-module-boundary.md) | `?raw` fixture import in production src | structure | `resolved` | medium |
| [15](issues/15-doc-drift-and-dead-code.md) | False `CONTEXT.md` convention; dead code | hygiene | `resolved` | low |

Ticket 13 also records an explicit **deferral** on shared chart primitives, with
the recommendation to file a separate refactor ticket.

## Track 6 — Tracker reconciliation (16)

| Ticket | Title | Blocked by | Status | Severity |
| --- | --- | --- | --- | --- |
| [16](issues/16-showcase-tracker-reconciliation.md) | Reconcile the showcase tracker | 04, 05, 07, 10, 12, 14, 15 | `resolved` | medium |

Corrects parent ticket 04's false "no analysis requests" claim, writes parent
ticket 03's missing record, and answers parent ticket 02's open completion
question rather than deferring it again.

**Decision, 2026-10-16:** [16](issues/16-showcase-tracker-reconciliation.md)
reconciled the parent tracker. Parent 02 is complete at its data-layer boundary;
parent tickets 15 and 16 record the remaining identity-error and lifecycle-copy
implementation gaps. The successful bounded canary is historical execution
evidence, not a current runtime or free-route reliability claim.

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
That is how this effort landed: every area in its own commit, and the backend,
AI, ops and docs work that shared the working tree is in per-area commits of its
own rather than folded into a tracker commit. Keep it that way — a tracker
commit that carries code makes the record unverifiable.

## What completing this effort does not achieve

The showcase remains **not demonstrable**. Still open:

- Parent tickets 11 (market cold-start) and 13 (news policy), both
  `ready-for-human`
- Private hosting and non-redistribution rights review
- Part-1-only prospectus inputs — absent sections must never be described as
  absent in the issuer's complete prospectus
- Parent tickets 06, 08, 09 (prospectus reader, news/a11y, rehearsal). Parent 07
  resolved: discovery publishes the one-stock/one-prospectus canary only
- No human screen-reader or assistive-technology audit anywhere in this effort
