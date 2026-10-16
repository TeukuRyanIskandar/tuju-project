# 05 — Present automatic TA/FA and lifecycle states

Status: ready-for-agent
Type: task
Blocked by: 02, 04

## Goal

Make automatic stock analysis understandable and honest per [the spec](../spec.md).

## Work

- Render independently queried TA/FA summaries and rich artifacts.
- TA: narrative, timeframe/date, SMA/RSI/MACD/52-week facts and structured events.
- FA: narrative, period/date and all nine metrics, units and per-metric dates.
- Separate AI explanation from code-computed facts; verify percentage scaling
  from producer/fixtures. No frontend scores, advice or null-value explanations.
- Implement every lifecycle state in the spec, including facts-only, stale,
  failed with/without retained artifact, partial artifact read and analysis 404.
- Add read-only refresh with bounded coherence handling; no enqueue/polling.

## Acceptance criteria

- Given ready artifacts, all supported facts/metrics render with correct dates
  and units; zero is distinct from null.
- Facts-only output shows facts and an explanation-unavailable notice, not worker
  placeholder prose as normal narration.
- Stale or retained failed results remain labelled; failed/no-pointer is local.
- TA failure does not hide FA/chart; unsupported TA/FA does not hide market data.
- Events distinguish fired observations from checks that did not fire.
- Refresh does not submit jobs or show unmatched summary/detail as verified.

## Verification

Fixture-driven component tests for all statuses, nine metric IDs/nulls/scaling,
event states, wrong symbol/kind/date and independent failures; typecheck/test.

## Comments

### Implementation — approved workflow revision 1 (2026-10-16)

- Implemented this ticket's analysis panels only. Tracker completion/triage is
  left to the coordinator; the status above is not a claim that implementation
  is still absent. Manual review and live rehearsal limits are recorded below.
- Prerequisite reconciliation: ticket 02 still says `ready-for-agent`, but its
  cost-free browser schemas, stock query builders, coherence checks and independent
  imperative analysis lifecycles exist in the working tree. Baseline frontend
  typecheck and its 16 analysis/coherence/lifecycle tests passed before edits.
  Reused these seams without changing their implementation or shared contracts.
  This is not wholesale certification or completion of ticket 02.
- Ticket 04's stock detail/header/history components and route integration already
  existed, despite its unchanged tracker status. Its recorded results were treated
  as historical; the current full frontend suite and built-SPA browser tests were
  rerun. Only its analysis placeholders and affected test assumptions changed.
- Initial `git status --short` / `git diff --stat` inspection found existing tracked
  changes in AGENTS/docs, backend yfinance adapters/tests, frontend context/API/
  shell/routes, contracts context/schema/tests and AI pipeline/tests. Existing
  untracked work included OpenCode agents/lib/plugins/skills/tests/config, this
  showcase tracker, frontend analysis APIs/tests, market and stock components,
  stock browser tests, workflow/skills docs and contract browser-artifact tests.
  All were preserved. Relevant pre-existing API/schema/route diffs were inspected;
  no backend, worker, shared-contract, dependency or configuration changes made.
- Added `use-stock-analysis.ts`: independent TA/FA React lifecycle adapters publish
  summary loading, thin data, detail loading and detail completion snapshots.
  Mounted, resource-identity and request-generation guards discard obsolete
  completions. Refresh uses existing query builders/GETs only; no fetch in
  components, polling, enqueueing or new subscription API.
- Added `stock-analysis-panel.tsx`, `technical-analysis.tsx`,
  `fundamental-analysis.tsx` and `analysis-presentation.ts`. They display statuses,
  UTC result/generation timestamps, calendar metric/event dates, source and actual
  narrative language. Computed facts and AI explanation are separate. All nine
  FA metric IDs have deterministic rows, with missing/duplicate rows unavailable.
  TA includes all requested facts and explicit fired/not-fired event values.
- Percent semantics are explicit, not magnitude-based: fixture `percent` values
  are fractions; producer `%` dividend yield/ROE values are fractions; producer
  `%` growth values are percentage points. Units (including fixture `myr`), dates,
  zero, null and false remain distinct; unknown units are shown unconverted.
- Facts-only recognition covers status, `facts-only: ` headline and both actual
  worker placeholder narratives, including stale/failed promotion. Placeholder
  diagnostics/error messages, private pointers, costs and stacks are not rendered.
  Normal narrative is plain text, marked AI-generated; no invented interpretation.
- Rich output is shown only for matched pairs. Retained pairs are labelled
  separately from the latest thin summary, with their own dates. A failed summary
  refresh labels retained summary metadata too. Persistent symbol/date mismatch
  stops after exactly two artifact reads. Wrong kind fails strict schema in tests;
  production coherence still rejects wrong kind. 404/error/empty output is local.
- Because production `apiGet` intentionally skips runtime validation, the panel
  also reuses the existing public artifact schemas before rendering rich content.
  Malformed identity-matched production output stays local, retaining the last
  renderable pair even across repeated malformed reads and never across identities.
- Added adjacent presentation/lifecycle/panel tests and typed golden-fixture support
  (`analysis-fixtures.ts`); updated stock-detail tests and browser coverage. No news,
  discovery, prospectus, chart redesign, provisioning, commits or pushes.

### Verification — actual final results

- `pnpm --filter contracts test` — passed: 4 files, 72 passed / 3 skipped.
- `pnpm --filter frontend typecheck` — passed (baseline and final).
- `pnpm --filter frontend test src/api/analysis.test.ts src/api/analysis-results.test.ts`
  — passed: 2 files, 16 tests (baseline and final).
- `pnpm --filter frontend test` — passed: 23 files, 329 tests. Existing jsdom
  `Window.scrollTo` not-implemented notices are non-failing. New helper/lifecycle/
  panel tests account for 47 tests; original stock/history tests remain passing.
- `TZ=America/Los_Angeles pnpm --filter frontend test src/components/stocks/analysis-presentation.test.ts src/components/stocks/stock-analysis-panel.test.tsx`
  and the same command with `TZ=Pacific/Kiritimati` — passed, 42 tests each.
- `pnpm --filter frontend build` — passed; static SPA shell prerendered. Stock
  route client chunk: 21.22 kB / 7.03 kB gzip (whole route, not isolated UI cost).
- `pnpm --filter frontend test:e2e` — passed: 6 Chromium tests. Built SPA with
  mocked transport verifies independent core/history/TA/FA failures, facts-only
  suppression, exact bounded mismatch reads, retained results after read failures,
  repeated malformed production artifacts, GET-only refresh, native Enter/Tab
  controls and no page horizontal overflow at 390px (existing chart test: 360px).
- `git diff --check` — passed. All owned paths also checked separately against
  `/dev/null`, because most were already untracked and ordinary diff omits them.
- Self-review against frontend context/design conventions and approved ticket
  scope: no unresolved implementation blocker. No new dependencies or advice.
- Iteration failures were corrected before final verification: lowercase fixture
  `myr` formatting, test thin timestamp normalization, a test generic mismatch,
  and Node's required JSON import attribute in the browser-test fixture imports.

### Remaining verification limits

- No live backend/session/CORS/artifact freshness or deployment rehearsal evidence;
  tests use mocked HTTP and golden fixtures, not proof of live producer availability.
- No manual visual/keyboard session or human screen-reader/assistive-technology
  audit performed. Automated real-Chromium keyboard and narrow-viewport checks
  passed, but do not replace the requested manual review.
- Mutable latest-pointer reads cannot prove atomic provenance when distinct runs
  have indistinguishable visible metadata. The UI says matched, not atomically
  verified or live. Ticket 02/04 overall tracker reconciliation remains separate.

### 2026-10-16 — Audit findings; three defects and one root cause filed

An audit of this ticket's implementation verified the substantive behaviour
against the code: all nine FA metrics render with unit and per-metric date,
missing or duplicate rows become unavailable rather than zero, facts-only
suppression matches both worker placeholder strings byte for byte, AI explanation
and computed facts are structurally separate, fired and not-fired events are
distinguished, and there is no browser enqueue, frontend score or advice
anywhere.

Four findings are filed as remediation tickets in
[`../blocker-fixes/`](../blocker-fixes/map.md):

1. **Percentage scaling is a hardcoded per-metric-id table.** This ticket's
   "percent semantics are explicit, not magnitude-based" claim describes the
   decision, but the shipped rule at
   `apps/frontend/src/components/stocks/analysis-presentation.ts:22-24` re-encodes
   producer knowledge in the frontend and cannot distinguish a fraction from a
   percentage point. Root cause is upstream: the backend stamps `unit: '%'` on
   both. Filed as
   [01](../blocker-fixes/issues/01-contract-percent-scale.md) through
   [04](../blocker-fixes/issues/04-frontend-scale-presentation.md).
2. Duplicate identical `role="alert"` when a detail read errors with a malformed
   retained pair — [11](../blocker-fixes/issues/11-analysis-panel-duplicate-alert.md).
3. The "Matched summary and detail" label describes a metadata check on a
   mutable-latest read, never an atomic one. The non-atomic caveat is recorded
   here and in `apps/frontend/CONTEXT.md` but is not visible on screen. Noted in
   [11](../blocker-fixes/issues/11-analysis-panel-duplicate-alert.md); a separate
   decision is needed if a presenter could be misled.
4. Test-only fixtures with `?raw` contract-JSON imports sit in production source
   — [14](../blocker-fixes/issues/14-fixture-module-boundary.md).

Also unaddressed and out of scope for those tickets: this ticket's stale state
warns only "not current", while the parent spec asks it to warn what the result
*trails*; and the analysis-unavailable label differs from the spec's wording.

**Status is unchanged at `ready-for-agent`**; this comment is evidence, not a
completion claim. No test suite was executed during the audit.

### 2026-10-16 — Reconciliation: implemented with lifecycle-copy follow-up

Blocker-fixes 01-04 replaced the per-metric-id scaling table with contract-driven
scale formatting; 11 removed the duplicate alert; and 14 moved raw contract
fixtures out of production source. The implementation and its recorded offline
verification therefore remain substantive.

This ticket stays `ready-for-agent`, not because the implementation is absent,
but because the stale-result copy does not say that it trails the latest stored
EOD data and the analysis-unavailable wording differs from the parent spec. Those
remaining requirements are scoped in [ticket 16](16-analysis-lifecycle-copy-conformance.md).
No live availability, atomic provenance or human accessibility review is claimed.
