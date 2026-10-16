# 09 — Verify and rehearse the complete private showcase

Status: ready-for-agent
Type: task
Blocked by: 01, 02, 03, 04, 05, 06, 07, 08

## Goal

Prove [the showcase](../spec.md) works end to end with honest data and failure states.

## Work

- Browser journey: market → prepared stock → market → prospectus; test direct
  stock/IPO reloads, market controls, search coverage and responsive navigation.
- Assert no enqueue requests. Test independent panel failures, stale/facts-only,
  unsupported analysis, missing news and older prospectus insights.
- Run contracts tests, FE typecheck/test/build/e2e and record actual outcomes.
- Rehearse against target backend with selected real results; confirm dates,
  provenance, artifact coherence and usable market panels. Fixtures are for tests
  only, never a substitute for deployment rehearsal.
- Write `../rehearsal.md` with steps, IDs, evidence, data-preparation prerequisites,
  access restrictions and remaining caveats. Obtain operator confirmation before
  sharing; do not trigger paid precomputations without approval.

## Acceptance criteria

- Browser journey and direct reloads pass, without login or model execution.
- At least one complete TA/FA stock and one prospectus work against actual APIs;
  target selection shortfalls and market-data gaps are explicitly documented.
- All prescribed checks have recorded outcomes; skips/failures are not passed off
  as successful verification.
- Manual keyboard/narrow-width checks and private-data/source caveats are recorded.
- Any blocking backend/data gap has an explicit follow-up and blocks showcase
  acceptance rather than being hidden with frontend fixtures.

## Verification commands

```bash
pnpm --filter contracts test
pnpm --filter frontend typecheck
pnpm --filter frontend test
pnpm --filter frontend build
pnpm --filter frontend test:e2e
```
