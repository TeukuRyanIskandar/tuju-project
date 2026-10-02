# Build ticket: Wire contract — `system` trigger + verdict-less `Summary` variant

Type: task
Status: resolved
Blocked by: — (none; can start immediately)

> Ticket 01 of the spec-06 execution effort. Fixed inputs: ADR-0007 (job/
> result contract — job names and enum members are added additively, never
> renamed/removed), ADR-0002 (`packages/contracts` is the single cross-
> language schema source; both TS and Pydantic are generated from it). This
> is the shared prerequisite tickets 02, 03, and 05 all depend on.

## What to build

The additive contract change spec 06 needs before any of its three AI
artifacts can enqueue a job: a `'system'` trigger value, and a summary shape
for artifacts that aren't bullish/bearish/over/under-valued (the prospectus
at-a-glance has no verdict).

- Add `'system'` to the `Trigger` enum (`packages/contracts/src/enums.ts`).
  Existing `'user' | 'price-move'` members are untouched.
- Add a new, separately-named verdict-less `Summary` variant: `{ headline:
  string, asOf: string }` — no `verdict` field. Keep the existing `Summary`
  (`{ verdict, headline, asOf }`) exactly as-is for TA/FA.
- Update `JobResult.summary` so it accepts either summary shape (the
  existing verdict-bearing one, or the new verdict-less one).
- Regenerate TS + JSON Schema + Pydantic
  (`pnpm --filter @tuju/contracts generate`) and verify the drift-gate
  `check` task passes.

## Acceptance criteria

- [x] `Trigger` enum includes `'system'`.
- [x] A new verdict-less summary schema exists, named distinctly from the
      existing `Summary` (e.g. `SystemSummary` or similar — pick a name that
      reads clearly against the existing `Summary`/`Verdict` naming, not
      literally this placeholder).
- [x] `JobResult.summary` type-checks against either summary shape.
- [x] `pnpm --filter @tuju/contracts generate` run; generated TS/JSON
      Schema/Pydantic outputs committed; the drift-gate `check` task is
      green.
- [x] Existing TA/FA contract tests/goldens are unchanged and green —
      nothing about the existing verdict-bearing path moves.

## Out of scope (later tickets under this effort)

- The three new `JobName` values (`generate-market-brief`,
  `summarize-announcement`, `analyze-prospectus`) and their payloads — each
  is added by the ticket that implements that job (02, 03, 05 respectively),
  as part of that ticket's own vertical slice.
- The ADR-0007 amendment doc (ticket 06) — written once the real shapes from
  02/03/05 are known.

## Resolution notes

- `Trigger` gained `'system'` (additive, `enums.ts`); `'user'`/`'price-move'`
  untouched.
- New `SystemSummary` schema (`result.ts`): `{ headline, asOf }`, no
  `verdict` — named against the existing `Summary`/`Verdict` pair rather than
  something that stutters against `Summary`. `JobResult.summary` is now
  `z.union([Summary, SystemSummary])`.
- **Review catch during implementation:** `Summary`/`SystemSummary` had to
  become `z.strictObject(...)` (was a plain `z.object(...)`, which strips
  unknown keys rather than rejecting them). Without `.strict()`, a
  verdict-bearing payload with a malformed `verdict` (e.g. `"mega-bullish"`)
  would fail the `Summary` arm of the union but then silently match the
  `SystemSummary` arm (the bad `verdict` key just gets stripped) — the union
  resolved to the WRONG variant instead of rejecting. `.strict()` makes
  `additionalProperties: false` (already true in the emitted JSON Schema)
  true at runtime too, so the union disambiguates correctly. Caught by the
  pre-existing "rejects an out-of-enum verdict" golden test going red after
  the union landed.
  - **How to apply:** any future zod schema that's one arm of a `z.union(...)`
    with another object-shaped arm needs `.strict()`/`.strictObject()` —
    plain `z.object(...)`'s default "strip unknown keys" behavior breaks
    union disambiguation between sibling object shapes.
- New golden fixture `job-result-system.json` (verdict-less `JobResult`),
  wired into both the TS (`fixtures.test.ts`) and Python
  (`test_contracts_conformance.py`) conformance suites, plus a positive
  "accepts the system trigger" test on each side.
- `pnpm --filter @tuju/contracts generate` run; `schema/contracts.schema.json`
  and `services/ai/src/tuju_ai/contracts_generated/models.py` regenerated and
  committed. Drift-gate `check` is green against the committed tree.
- **Consumer fallout (not originally in scope, but required for the repo to
  type-check):** `apps/backend/src/analysis/analysis-result.store.ts` read
  `result.summary.verdict` unconditionally — that table is TA/FA-only
  (`verdict` is a required column), so it now narrows with an
  `isVerdictSummary()` guard and skips (logs + returns) a verdict-less result
  rather than persisting it. Tickets 02/03/05 own the real persistence paths
  for system-triggered artifacts; this store is unaffected until they land,
  since `JobName` still only has `analyze-technical`/`analyze-fundamental`.
  Same guard applied to the one other direct TS read, in `job-bus.int-spec.ts`.
  - **The guard lives in `apps/backend/src/jobbus/job-result-helpers.ts`, NOT
    `@tuju/contracts`**, despite that being the obvious DRY move (tried first
    during review, then reverted) — `@tuju/contracts`'s `package.json` only
    declares an `"import"` export condition (ESM), so a `require()` of it
    (what `ts-jest` compiles backend code to, per `apps/backend/tsconfig.json`'s
    `"module": "CommonJS"`) throws `ERR_PACKAGE_PATH_NOT_EXPORTED` at runtime.
    Every existing backend import from `@tuju/contracts` is `import type`
    (type-only, fully erased by `tsc`) — the backend has **never** actually
    imported a runtime value from the package before, so this packaging gap
    was latent and untriggered until this guard became the first one. Fixing
    the dual CJS/ESM export is real, separate work (a `package.json`
    `"require"` condition + a CJS build target), out of scope here; the
    backend-local helper sidesteps it by staying a pure type-only consumer of
    `@tuju/contracts` like everything else in the app.
    - **How to apply:** before adding ANY value-level (non-`import type`)
      import from `@tuju/contracts` into `apps/backend` or `apps/frontend`,
      confirm the package's dual-format export story first — today it has
      none.
  - **Python side is NOT narrowed** (`services/ai/src/tuju_ai/handler.py:124`,
    `smoke.py:59`, and three test assertions also read `result.summary.verdict`
    unconditionally): `services/ai` has no static type checker in its lane
    (`pyproject.toml` — no mypy/pyright), so the now-union
    `Summary | SystemSummary` Pydantic field doesn't block anything there, and
    the worker only ever constructs TA/FA (verdict-bearing) results today. Left
    alone deliberately rather than touched speculatively; flagged here so a
    future mypy/pyright adoption (or ticket 02/03/05, which will make the
    worker actually emit `SystemSummary` results) doesn't rediscover this cold.
- **Design-level review note (no code change):** two review findings pushed
  back on the *shape* this ticket was asked to build, not the fidelity of the
  implementation to it — worth recording since they bear on ticket 06 (the
  ADR-0007 amendment):
  - ADR-0007 §5's "Option A" rejection was about NOT enumerating rich
    indicator/metric data into the summary (richness), not about a summary
    ADT/union (shape) — `SystemSummary` stays just as thin as `Summary`, so
    this reading doesn't apply, but a reviewer could plausibly conflate the two.
  - Reusing `Trigger` to also signal "this result has no verdict" couples two
    independent axes (why a job ran vs. what shape its result has) onto one
    enum. This was a pre-existing design call from `map.md`'s Decisions
    ("Decided with the user before ticket-drafting"), not something ticket 01
    introduced — recorded here so ticket 06 can address it explicitly rather
    than re-litigate it from scratch.
