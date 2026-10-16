# 15 — Remove doc drift and dead code

Type: task
Status: resolved
Blocked by: none
Severity: low
Component: `apps/frontend`

## Problem

One context document states a convention that does not exist in the code, and
three pieces of dead or no-op code are presented as if they were meaningful.

## Evidence

**15a — `CONTEXT.md` documents a convention with zero occurrences.**
`apps/frontend/CONTEXT.md:12`:

> Route loaders call `context.queryClient.ensureQueryData(xQuery(...))`

`ensureQueryData` appears **nowhere** in `apps/frontend/src`. Stock and market
reads are component-level `useQuery` / `fetchQuery` only. The sentence describes a
data-loading pattern this app does not use, which will actively mislead the next
reader or agent — it is the kind of false convention that gets copied into new
code.

Note the same file's later sections are accurate: the analysis-reads section
describes `refreshSummary()` / `refreshDetail()` / imperative lifecycles, which
matches the implementation.

**15b — `placeholderData: undefined` sold as a guarantee.**
`apps/frontend/src/components/stocks/stock-detail.tsx:37-45`. The comment reads:

> No suspense/loader coupling, and explicitly no cross-resource placeholder data.

`placeholderData: undefined` **is** the TanStack default. The option states
nothing; the comment implies a deliberate guard that does not exist. Either drop
the option or, if the intent is a regression guard, say so plainly and add a test.

**15c — Redundant `key` on the analysis panels.**
`stock-detail.tsx:78-79` passes `key={`ta-${code}`}` and `key={`fa-${code}`}`.
`apps/frontend/src/routes/stocks.$code.tsx:11` already remounts on code change, so
these keys never fire. Harmless, but they imply a per-code isolation mechanism
that lives somewhere else.

**15d — Dead exports.**
- `export function HistoryChart` at
  `apps/frontend/src/components/market/market-overview.tsx:46` has no external
  importer and no direct test.
- `export const stockCorporateActionsQuery` at
  `apps/frontend/src/api/stocks.ts:135-152` has no consumer.

The `stockCorporateActionsQuery` builder looks like pre-existing intended surface
rather than something this effort added — check its history before deleting. If it
is a deliberate placeholder for upcoming work, keep it and note why. If not,
remove it.

## Root cause

Work accumulated in a large uncommitted diff, where defensive-looking options and
stale documentation survive because nothing ever reviews a diff that has never
been committed.

## Fix

1. Correct `apps/frontend/CONTEXT.md:12` to describe what the app actually does.
   If a loader convention is genuinely intended for future routes, say that
   explicitly as a plan rather than as current practice.
2. Resolve `stock-detail.tsx:37-45`: either remove the no-op options and keep a
   plain comment, or keep them with an honest comment plus a regression test.
   Do not leave a comment claiming a guard that is a default.
3. Remove the redundant `key` props at `:78-79`, or add a comment explaining why
   belt-and-braces. Prefer removal.
4. Make `HistoryChart` non-exported unless a test needs it directly.
5. Decide `stockCorporateActionsQuery`'s fate based on its history, then remove or
   document.
6. Sweep the same uncommitted diff for further no-op `placeholderData`, redundant
   keys or unused exports and fold them in — this ticket is the cleanup pass, not
   just the four items above.

## Acceptance criteria

- `CONTEXT.md` contains no convention statement contradicted by the code.
- No comment claims a guarantee that a default value happens to provide.
- No unused export remains without a documented reason.
- The full frontend suite and typecheck pass.

## Verification

```bash
pnpm --filter frontend test
pnpm --filter frontend typecheck
pnpm --filter frontend build
```

## Resolution

- Corrected the data-loading convention: routes do not preload backend reads;
  components use `useQuery` and imperative reads use `fetchQuery`. Updated both
  the frontend context and README, which repeated the stale claim.
- Removed `placeholderData: undefined` and its misleading comment, and removed
  the redundant TA/FA keys (the route remounts `StockDetail` on code changes).
- Made the market `HistoryChart` private. Retained
  `stockCorporateActionsQuery`: git history shows it was introduced in the
  original typed stocks API-layer commit with the endpoint schema and key
  factory, so it remains an intended reusable API builder despite having no UI
  consumer yet.
- Sweep found only the intentional `keepPreviousData` option in search and no
  additional redundant resource keys needing cleanup.
- Verification passed: frontend suite (339 tests), typecheck and production build.
  The rebuilt stock route client chunk is 22.37 kB (7.38 kB gzip).

Grep for `ensureQueryData` after the edit to confirm the stale convention is gone
from docs and has not been reintroduced in code.

## Limits

- Do not reformat unrelated files. This is a targeted cleanup; a broad reformat
  would make the eventual commit review harder.
- Do not touch backend or AI documentation drift in this ticket. `services/ai` and
  `apps/backend` have their own `CONTEXT.md` files and their own review paths.
- The bundle-size figures recorded in parent tickets 04 and 05 are not
  reproducible read-only. If this ticket's removals change the stock route chunk,
  record the new figure rather than assuming it matches.
