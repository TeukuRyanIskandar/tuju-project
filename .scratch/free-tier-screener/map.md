# free-tier-screener — execution effort (spec 03 implementation)

Breaking [spec 03 — screener](../free-tier-specs/03-screener.md) into build
tickets. Backend only. Ticket work lands in `apps/backend`.

## Ticket status

| # | Ticket | Wave | Blocked by | Status |
| - | ------ | ---- | ---------- | ------ |
| 01 | [Cache seam + screener query read model](issues/01-cache-seam-screener-read-model.md) | 1 | — | **resolved** (committed `307ba6b`) |
| 02 | [Screener endpoint (`GET /screener`)](issues/02-screener-endpoint.md) | 2 | 01 | **resolved** (working tree, uncommitted) |
| 03 | [Screener fields endpoint (`GET /screener/fields`)](issues/03-screener-fields.md) | 2 | 01 | **ready-for-agent** (frontier) |

Wave 1 resolved and verified, committed as `307ba6b`. Ticket 02 (wave 2)
resolved and verified in the working tree — typecheck + build clean; full
suite **278/278** across 24 suites incl. all testcontainers suites;
`test:int` 2/2 — uncommitted, pending user review. Ticket 03 remains on the
frontier.

## Wave structure

- **Wave 1:** ticket 01 — the `cache:screener:` prefix + invalidation hooks
  (the established spec-02/04 pattern) and the `ScreenerQuery` seam
  (interface + Postgres read model) both wave-2 endpoints read through.
- **Wave 2 (parallel):** ticket 02 (`GET /screener`) ∥ ticket 03
  (`GET /screener/fields`) — fresh-context sub-agents in their own files, then
  `app.module.ts` wiring + full verification by the orchestrator.
- **Ticket 02 resolved (working tree, uncommitted):** endpoint trio
  (`screener.controller.ts` + `screener.service.ts` + `screener.module.ts`,
  the `SearchModule` shape) wired into `app.module.ts`. Canonical cache key
  `cache:screener:screen:<canonical>` built from the RESOLVED params (fixed
  field order, null → dropped fragment, sorted comma-joined boards/sectorIds,
  resolved clamped pagination) so equivalent requests share one entry; 29 raw
  params ride one whole-`@Query()` object narrowed by a pure
  `rawScreenerParams()` picker in `params.ts` (the single home of the HTTP
  param-name mapping, unit-pinned). Response = `ScreenerPage` + sort/dir
  echoes. One ticket-01 seam bug found by the module wiring: the seam's
  `import type { DataSource }` left the constructor's DI token unresolved
  (invisible while ticket 01's spec instantiated it standalone) — fixed to a
  value import.

## Decisions / notes so far

- **Spec gap resolved by user decision at publishing time:** spec 03 asserts
  `yoyProfitGrowth` and `profitableYears` are materialised on
  `FundamentalsSnapshot`, but the spec-01 materialiser only writes
  `consecutiveGrowthQuarters`. Decision: **query-time aggregation from
  `QuarterlyFinancials`** (lateral joins inside the screener read model —
  ~12k rows at demo scale, trivially cheap; matches the source decision doc's
  "profitableYears from QuarterlyFinancials" wording). No spec-01 widening, no
  migration. The consecutive-trailing-years count uses an array trick — no
  window functions.
- **%change + volume are read-time** from the two latest EOD `PriceBar`s (the
  stock page's read-time %change precedent, spec 02).
- **`aboveSma50`/`aboveSma200`** compare latest close vs the snapshot SMA with
  `(expr) IS TRUE` / `IS FALSE` semantics, so a NULL (no bars or no SMA) matches
  neither value — same posture as the `shariah` boolean.
- **Provenance is per-numeric-class** on the row: `price` (from the bar's run),
  `fundamentals` (snapshot's run), `technicals` (indicator run's). Reference
  fields (code/name/sector) are `real` by contract (the stock page precedent).
- **Pagination reuses** `stocks/pagination.ts` (`resolvePagination`: default 50,
  max 100 — exactly spec 03's numbers).
- Entities + migrations are NOT modified by any ticket.
