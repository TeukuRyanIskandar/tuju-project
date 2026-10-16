# 11 — Remove the duplicate analysis detail alert

Type: bug
Status: ready-for-human
Blocked by: none
Severity: low
Component: `apps/frontend`

## Problem

The analysis panel can render two identical `role="alert"` elements stating the
same thing. For a screen-reader user that is a double announcement of an error
that occurred once.

## Evidence

`apps/frontend/src/components/stocks/stock-analysis-panel.tsx:53-54`:

```tsx
{state.detail.status === 'error' && <p role="alert">Analysis detail unavailable. Retry with refresh.</p>}
{!validShape && <p role="alert">Analysis detail unavailable. Retry with refresh.</p>}
```

These are independent conditions. `validShape` is computed at `:24` as
`!candidate || validArtifact(candidate.artifact)`, where `candidate` falls back to
`state.previousPair` when the status is not `matched` (`:18`).

So both fire when a detail read **errors** while a retained pair exists whose
artifact fails the browser schema — an identity-matched but malformed artifact,
which is a real production path because `apiGet` skips runtime validation.

No test covers the combination. Every existing assertion uses a singular
`getByRole('alert')` or `findByRole('alert')`, which throws on multiple matches —
so the suite could not have caught this even if it had tried.

## Root cause

Two overlapping error conditions were added independently without checking
whether they can co-occur, and the test helper pattern cannot express "exactly one
alert".

## Fix

1. Make the two conditions mutually exclusive. The detail-error state and the
   malformed-shape state are two ways of reaching the same user-facing outcome, so
   render one alert. Simplest correct form is to derive a single boolean and use
   it once.
2. Keep the `state.detail.status === 'mismatch'` alert at `:55` separate — that is
   a genuinely different message ("does not match the summary after one reread")
   and a different condition, not a duplicate.
3. Add a test that constructs an errored detail read **with** a malformed retained
   pair, and assert exactly one alert is present. Use `getAllByRole` so a future
   regression fails loudly rather than passing on the singular matcher.
4. Consider a shared `getAlertCount` helper across the panel's test files so this
   class of bug is expressible everywhere.

## Acceptance criteria

- Exactly one detail-unavailable alert renders when a detail read errors with a
  malformed retained pair.
- The mismatch alert still renders separately and is not swallowed.
- A regression test asserts the count, using a matcher that can observe
  duplicates.

## Verification

```bash
pnpm --filter frontend test
pnpm --filter frontend typecheck
```

## Limits

- Do not remove the `lastRenderable` retention logic at `:25-33`. It is a
  deliberate decision (parent ticket 05's comment): a malformed production body
  can pass metadata coherence, and retaining the last renderable pair keeps other
  panels usable. This ticket fixes the duplicate alert, not the retention policy.
- Separately worth noting, not fixing here: the retained-pair path at `:31-32` has
  no date comparison against the current summary, so a retained artifact can be
  from an older run with no wording beyond "Retained previous matched result — not
  current". Record it if you touch that code; do not expand scope.
- The label "Matched summary and detail" at `:58` describes a mutable-latest
  metadata check, not an atomic read. The non-atomic caveat currently lives only
  in `apps/frontend/CONTEXT.md` and parent ticket 05's comment, never on screen.
  Out of scope for this ticket; worth raising separately if a presenter could be
  misled.

## Comments

- The single `detailUnavailable` condition and exact-count regression test were
  already present in the working tree before this implementation round. The full
  frontend suite passes (339 tests) and typecheck passes.
