# 14 — Move the analysis fixture module out of production source

Type: task
Status: ready-for-agent
Blocked by: none
Severity: medium
Component: `apps/frontend`

## Problem

A test-only module that inlines two contract fixtures as strings sits in the
production component directory. Nothing imports it today except a test, so it is
dead weight in the source tree — and a bundle-size trap for whoever imports it
next.

## Evidence

`apps/frontend/src/components/stocks/analysis-fixtures.ts:1-3`:

```ts
import { StockTechnicalAnalysisArtifact, StockFundamentalAnalysisArtifact, ... } from '@tuju/contracts'
import technicalJson from '../../../../../packages/contracts/fixtures/technical-analysis-artifact.json?raw'
import fundamentalJson from '../../../../../packages/contracts/fixtures/fundamental-analysis-artifact.json?raw'
```

The `?raw` suffix makes Vite inline the **entire JSON file contents as a string
literal** into any bundle that reaches this module. Both fixture files are full TA
and FA artifacts.

The `../../../../../` path also reaches out of `apps/frontend` and across
`packages/`, which dependency boundaries should not require for test data.

Current sole importer: `stock-analysis-panel.test.tsx`.

## Root cause

The module was placed next to the component under test for convenience, with no
boundary separating test fixtures from production source. Nothing enforces that
boundary today, so the placement is convention-only.

## Fix

1. Relocate to a test-only location that matches this app's existing convention
   for test helpers or fixtures. Check what `*.test.ts` files elsewhere import and
   follow it rather than inventing a new convention.
2. Replace the `../../../../../packages/...` traversal with a path alias if one
   exists, or import the fixtures through the package's public surface if
   `fixtures/` is exported — `packages/contracts/package.json` lists `fixtures` in
   `files`, so a subpath may already be available. Prefer an existing mechanism.
3. Keep the `publicBody` cost-stripping helper at `:6-9`; it models the browser
   proxy behaviour and belongs with the fixtures.
4. Consider a typed golden-fixture accessor rather than two module-level `parse`
   calls, so a malformed fixture fails with a clear message.
5. Verify nothing in `src/` outside a test imports the module after the move.

## Acceptance criteria

- No module under `src/components/`, `src/api/`, `src/routes/` or `src/lib/`
  imports contract fixture JSON via `?raw`.
- The fixture module lives in a location whose only consumers are tests.
- Relative traversal out of `apps/frontend` is gone.
- All existing analysis tests still pass with unchanged assertions.

## Verification

```bash
pnpm --filter frontend test
pnpm --filter frontend typecheck
pnpm --filter frontend build
```

After `build`, inspect the stock route chunk size and compare against the
`21.22 kB / 7.03 kB gzip` figure recorded in parent ticket 05. It should be
unchanged, which is the proof the fixtures were never in the bundle.

## Limits

- This ticket does not change any assertion. It is a relocation.
- Do not add a test that asserts "no fixture module in src" by scanning the tree —
  that is a lint rule, not a unit test, and belongs in tooling if wanted.
- [01](01-contract-percent-scale.md) regenerates
  `packages/contracts/fixtures/fundamental-analysis-artifact.json` with a `scale`
  field. The fixture module's `parse` calls will pick that up automatically, but
  the moved module must be re-verified after 01 lands.