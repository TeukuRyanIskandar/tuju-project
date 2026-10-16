# 04 — Build stock identity and EOD chart

Status: ready-for-human
Type: task
Blocked by: 02

## Goal

Establish the stock screen and chart per [the spec](../spec.md).

## Work

- Render core identity and EOD close/date, with back-to-market link and independent
  chart/error treatment; preserve usable panels if core read fails.
- Choose chart implementation after documenting React compatibility, licence and
  bundle tradeoff. Build daily close-price line/volume from 2y series; default
  1Y with 1M/3M/1Y/2Y local windows. No overlays/drawing tools.
- Provide date/value inspection and accessible data-table fallback.
- Convert numeric strings safely; preserve date-only trading days across zones.
- Prepare layout slots for independently loaded TA/FA and news.

## Acceptance criteria

- Correct company and chart appear when navigating between stock codes, with no
  prior-stock leakage; direct links load successfully.
- Range controls filter stored points without requesting intraday/new intervals.
- Missing/malformed/empty series does not plot fabricated zero or NaN values.
- Latest EOD date is distinguished from retrieval/analysis timestamps.
- Core and chart failures are local; unsupported analysis does not make a known
  stock a page-level not-found.
- Chart information is accessible without a pointer crosshair.

## Verification

Component tests for code changes, date windows/timezones, numeric conversion,
empty/error states and table fallback; typecheck/test/build.

## Comments

### Implementation — approved workflow revision 1 (2026-10-16)

- Prerequisite 02 reconciliation: its tracker status is still `ready-for-agent`,
  but the existing working tree already contains `stockCoreQuery`, the fixed
  `stockSeriesQuery` (`1d`/`2y`), per-code keys, cancellation via `apiGet`, and
  the shared `StockSeriesResponse` schema. Its API/query tests passed before
  implementation (20 tests across `api.test.ts` and `analysis.test.ts`). This
  establishes the concrete read seam needed by 04; it does **not** certify all
  of 02's contract/artifact/coherence acceptance criteria or mark 02 complete.
  Ticket 02 and the dependency declaration above are deliberately unchanged;
  coordinator/tracker reconciliation of 02's overall completion remains open.
- Preserved the pre-existing frontend API/market, backend, contracts, AI,
  instructions and OpenCode working-tree changes. No dependencies, backend or
  contract code changed; no generated route-tree edits, commits or pushes.
- Chart decision: native React SVG, compatible with the installed React 19 and
  ordinary DOM/pointer events. No external chart package, added runtime payload
  or third-party chart licence obligations. The tradeoff is maintaining the
  small scale/inspection implementation ourselves, appropriate for one bounded
  daily close/volume series without overlays. Final stock route chunk is
  9.82 kB / 3.68 kB gzip (whole route, not an isolated chart-size measurement).
- Replaced the stock placeholder with independent core and series reads. A
  keyed stock component resets local range/inspection on code changes; queries
  explicitly disable placeholder data and reject mismatched response identity.
  Failures/loading and same-code retained-refresh snapshots stay panel-local.
- Identity/code/company/sector/board and series-sourced EOD close/date are
  visible in the header. Series provenance/private-demo restrictions, stored
  EOD dates and client retrieval time are separately labelled. Core legacy
  technical snapshots are not passed off as EOD data. No live quote claim.
- Default 1Y plus 1M/3M/2Y inclusive calendar windows filter cached bars, anchored
  to the latest stored day, with month-end clamping. Numeric conversion accepts
  only complete finite numbers; negative price/volume is unavailable. Invalid
  dates are omitted; invalid quantities and duplicate days remain explicit gaps
  rather than fabricated zeroes or arbitrary duplicate winners. Absent calendar
  days are not manufactured (no inferred trading/holiday calendar).
- Native slider supports keyboard inspection; a keyboard-expandable labelled
  table/scroll region supplies exact date/close/volume fallback. Empty, single,
  flat and zero-valued histories are handled. Responsive TA/FA slots and a
  separate news slot are reserved only, with no analysis/news requests or jobs.

### Verification — final results

- `pnpm --filter frontend typecheck` — passed.
- `pnpm --filter frontend test` — passed: 20 files, 282 tests, including 40
  focused stock helper/chart/route-component cases. Existing jsdom
  `Window.scrollTo` not-implemented notices remain non-failing.
- `pnpm --filter frontend build` — passed; static SPA shell prerendered.
- `pnpm --filter frontend test:e2e` — passed: 5 Chromium tests. New built-SPA
  coverage includes direct stock load/reload, real native range keyboard
  interaction, local filters with one series request, expandable table,
  back-to-market navigation, independent failure/empty states and no page-level
  overflow at 360px. Transport is mocked in tests only.
- `TZ=America/Los_Angeles pnpm --filter frontend test src/components/stocks/stock-history.test.ts src/components/stocks/stock-history-chart.test.tsx`
  and the same command with `TZ=Pacific/Kiritimati` — both passed (31 tests each).
- `git diff --check` — passed. Self-review against repository conventions and
  ticket/spec scope found no remaining implementation blockers.
- Limits: no live backend/data freshness, CORS/session or deployment rehearsal;
  no human screen-reader/assistive-technology audit. These offline tests do not
  certify all of ticket 02 or the wider showcase. Native slider key behavior is
   verified in Chromium, not simulated by jsdom's unsupported range-key handling.

### 2026-10-16 — Reconciliation correction

The original implementation record at line 77 was accurate for that revision but
is no longer a current description: `stock-detail.tsx` now mounts the technical
and fundamental analysis panels, which issue read-only GET requests. The news
slot remains reserved, and browser refresh does not enqueue analysis jobs.

The figures above are historical results for the original revision, not current
suite totals. Later tracker records report subsequent frontend coverage and
remediation. The dependency on ticket 02 is satisfied by its implemented
data-layer seam, but both tickets await human acceptance; this correction does
not turn a mutable-latest read into atomic provenance or complete broader stock
screen follow-ups.
