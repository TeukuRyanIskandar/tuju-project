# 16 — Make analysis lifecycle copy conform to the showcase spec

Status: ready-for-agent
Type: task
Blocked by: none

## Problem

The analysis panels describe retained output as "not current", but the showcase
spec requires an honest explanation that it trails the latest stored EOD data.
The unavailable wording also differs from the specified local analysis state.

## Work

- Update stale and unavailable copy without fabricating a latest-EOD date.
- Preserve the existing retained-result, mismatch and local-failure semantics.
- Add focused component coverage for the revised wording.

## Acceptance criteria

- Stale output says it trails latest stored EOD data without claiming live data.
- Analysis-unavailable copy is locally scoped and spec-conformant.
- Copy changes do not alter query, retry or job-enqueue behaviour.

## Verification

Run focused frontend component tests, then frontend typecheck and test.
