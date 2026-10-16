# 02 — Add browser analysis schemas and FE queries

Status: ready-for-human
Type: task
Blocked by: none

## Goal

Supply validated read integration for [the showcase](../spec.md).

## Work

- In `packages/contracts`, export HTTP TA/FA artifact schemas derived from stored
  artifacts with cost omitted; do not alter worker artifact/codegen shapes.
- Extend FE stock query/key builders for series, TA/FA envelopes and artifacts.
- Reuse IPO builders; add refresh/coherence handling for changed pointers/dates.
- Validate identity/kind/date pairing; on mutable-latest race retry once then
  report mismatch instead of pairing a new summary with stale detail.
- Keep API base/credentials/cancellation/error semantics and query retry defaults.
  No component fetch, S3 URL or browser job mutations.

## Acceptance criteria

- Proxy-shaped cost-free TA/FA fixtures parse; stored artifacts still require cost.
- Stock/kind/series/result identities have isolated query keys.
- Changed result metadata invalidates/refetches rich content; failed refresh can
  retain clearly labelled previous data.
- A mismatched artifact is not presented as coherent; retry is bounded.
- Queries handle cancellation and non-2xx/contract failures consistently with
  existing infrastructure.

## Verification

Contract and FE query tests, including cost omission, result change, mismatch,
404, retry and cancellation; contracts test and FE typecheck/test commands.

## Comments

### 2026-10-16 — Audited as substantively implemented; reconciliation owed

An audit of this ticket found its implementation present and uncommitted, and
verified the load-bearing pieces against the code:

- Cost-free browser schemas at `packages/contracts/src/http/stocks.ts:178-181`
  are derived with `omit({ cost: true })` and do **not** reach codegen — they are
  unregistered, absent from `modelOrder`, and `packages/contracts/test/browser-artifacts.test.ts`
  asserts `buildJsonSchema()` is unchanged. Stored schemas still require `cost`.
- Query keys are isolated per code, kind, series and result identity
  (`apps/frontend/src/api/stocks.ts:38-44`). Pointer fields are identity only;
  transport always uses the fixed encoded backend route, never an S3 URL.
- Mismatch reads are bounded at exactly two
  (`apps/frontend/src/api/result-coherence.ts:80-86`) and return `mismatch` as
  data so Query retry cannot multiply them.
- Cancellation and error semantics run through `apiGet` with Query's signal and
  reuse the shared retry policy.

Two gaps remain, and the `prospectusResults` lifecycle is built but has no
consumer until ticket 06. The standing "reconciliation remains open" notes in
tickets 04 and 05 should not be re-derived.

**Status is unchanged at `ready-for-agent`** — this comment is evidence, not a
completion claim. Deciding whether this ticket is complete, and what "complete"
means with ticket 06 outstanding, is owned by
[`../blocker-fixes/issues/16-showcase-tracker-reconciliation.md`](../blocker-fixes/issues/16-showcase-tracker-reconciliation.md).

### 2026-10-16 — Reconciliation: data-layer implementation complete

The acceptance criteria are met at the data-layer boundary: browser artifact
schemas omit cost while stored schemas retain it; stock/kind/series/result keys
are isolated; result-pointer changes trigger bounded coherent reads with retained
data on refresh failure; and shared transport preserves cancellation, failures
and retry policy. The prior audit recorded the relevant code evidence above.

`prospectusResults` deliberately has no production consumer: the prospectus page
and its consumer-level lifecycle behaviour belong to [ticket 06](06-prospectus-page.md).
That separation is scope, not a waiver. The mutable latest API can prove matching
visible metadata after at most one retry, not atomic provenance. This ticket is
implemented and awaits human acceptance; it does not claim ticket 06 is complete.
