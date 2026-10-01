# Build ticket: Cache seam + screener query read model

Type: task
Status: resolved
Blocked by: (none)

> Wave 1 of the spec-03 execution effort breaking down
> [spec 03 — screener](../../free-tier-specs/03-screener.md). Fixed inputs:
> ADR-0004 (class-2 read cache, key-prefix separation), ADR-0006, ADR-0010,
> and the spec-01 entities/migrations (redefined nothing).

## What to build

The shared foundation every spec-03 endpoint reads through, verifiable on its
own (no endpoint consumes it yet — tickets 02/03 do):

1. **Cache seam:** a `SCREENER_CACHE_PREFIX` (`cache:screener:`) in the
   ticket-01-of-search `src/cache/` key constants, swept by the existing
   post-commit invalidation hooks (nightly `runNightly()` + decision-B
   `purgeUnlicensed()`), fail-loud, same as the other prefixes.
2. **Screener query read model:** a `ScreenerQuery` seam (interface +
   Postgres implementation, the `InstrumentSearch` pattern) in
   `src/screener/` — the single read model join `Instrument ⋈ Company ⋈
   Sector ⋈ FundamentalsSnapshot ⋈ IndicatorSnapshot ⋈ latest ShariahStatus
   ⋈ latest two PriceBars`, the full spec-03 filter set, sorting
   (NULLs last, deterministic tiebreaker), offset/limit + total count, and
   per-numeric-class provenance rows.

### Read model decisions (fixed by the effort map)

- `yoyProfitGrowth` + `profitableYears` are **query-time aggregations** over
  `QuarterlyFinancials` (lateral joins; no window functions — the
  consecutive-trailing-years count uses an array trick). Spec 03 asserts they
  are materialised; they are not (spec-01 gap, resolved by user decision).
- `%change` + `volume` are read-time from the two latest `PriceBar`s (spec-02
  stock-page precedent).
- `aboveSma50`/`aboveSma200` use `(close > sma) IS TRUE/FALSE` semantics — a
  NULL matches neither value (same as `shariah`).
- Param parsing follows the house posture: **clamp/drop, never a 400**
  (`parseEnumList` for boards, UUID-validation for sector ids, numeric/boolean
  parsing to `number | null`/`boolean | null`), and pagination reuses
  `resolvePagination` (default 50, max 100).
- Sort allowlist = the returned numeric columns (`close`, `pctChange` default,
  `marketCap`, `pe`, `dy`, `pNta`, `roe`, `de`), `asc`/`desc`, **NULLs last
  regardless of direction**, `stockCode` as the deterministic tiebreaker.
- Row shape per spec 03: `stockCode`, `shortName`, `sector`, `close`,
  `pctChange`, `marketCap`, `pe`, `dy`, `pNta`, `roe`, `de`, plus
  `provenance: { price, fundamentals, technicals }` (per-numeric-class
  lineage).

## Acceptance criteria

- [ ] `cache:screener:` prefix exists and is swept by the nightly ingest and
      the purge after commit (integration-pinned, same test shape as the
      search/stocks/disclosures prefixes).
- [ ] The seam screens the analysed universe (MAIN/ACE only — LEAP rows
      never appear) with every filter class returning the right rows:
      board, sector (FK ids), shariah boolean over the *latest* status,
      price/volume/market-cap bands, valuation (pe/dy/pNta) bands with
      NULL-ratio exclusion (loss-maker never in a P/E band), quality
      (roe/de bands, profitableYears), growth (yoyProfitGrowth,
      consecutiveGrowthQuarters), technical (rsi14 band, aboveSma50/200).
- [ ] Sorting: default `%change` desc; any returned numeric column asc/desc;
      NULLs last both directions; deterministic tiebreaker.
- [ ] Pagination: offset/limit (default 50, max 100, clamped), total match
      count returned.
- [ ] Rows carry per-numeric-class provenance (demo: `synthetic` price/
      fundamentals/technicals lineage joined live).
- [ ] Unit lane: param parsing (clamp/drop, never 400) with no containers.
- [ ] Integration lane (testcontainers Postgres): filter/sort/pagination
      behaviours over a seeded universe — external behaviour (which stocks a
      filter returns), not SQL internals.
- [ ] Entities + migrations untouched; no Nest module wiring (the seam is
      instantiable standalone; ticket 02 wires it).

## Out of scope (later tickets under this effort)

- The `GET /screener` endpoint + its cache keying (ticket 02).
- The `GET /screener/fields` endpoint (ticket 03).
- Stochastic filter, saved screens, anonymous rate-limiting (spec 03 Out of
  scope).

## Answer

Implemented as `apps/backend/src/screener/` + one-line cache/invalidation
wiring. All acceptance criteria pinned by tests; typecheck + build clean;
full suite **247/247** across 22 suites (incl. all testcontainers suites);
`test:int` 2/2.

### Files

- `screener-query.interface.ts` — the seam: `SCREENER_QUERY` DI token,
  `ScreenerFilters` (the full spec-03 filter set, resolved), `ScreenerQueryParams`,
  `ScreenerRow` (spec-03 row shape + `provenance: { price, fundamentals,
  technicals }` per-numeric-class lineage), `ScreenerPage` (items + total +
  resolved page window), the `ScreenerQuery` interface.
- `screener-query.pg.ts` — `PgScreenerQuery`: one parameterised page query +
  one count query over a shared read model (laterals resolve latest bars /
  shariah / YoY / profitable-years; **no window functions** — the
  consecutive-trailing-years count uses an `array_agg(...) > 0` flags array
  with `array_position(flags, FALSE) − 1`). `buildWhere` emits AND-combined
  positional-param clauses; board/sector use `ANY(...)::text[]`/`::uuid[]`,
  discrete booleans use `(close > sma) IS TRUE/FALSE` (NULL matches neither);
  sort allowlist maps to expressions, `NULLS LAST` both directions,
  `stockCode` tiebreaker; universe restriction `c.board IN ('MAIN','ACE')`
  rides the read model (LEAP never screens).
- `params.ts` — pure parsing (house posture: clamp/drop, never a 400):
  `parseNumericFilter` (empty string → null, not a leaked `Number('') === 0`
  band), `parseBooleanFilter`, `parseScreenerSort`/`parseScreenerDir`
  (defaults `pctChange`/`desc`), `parseSectorIds` (UUID-validated, deduped),
  `parseScreenerFilters` (boards ride `parseEnumList` — LEAP dropped),
  `parseScreenerQuery` (pagination reuses `resolvePagination`: default 50,
  max 100). Ticket 02's controller consumes these.
- Cache seam: `SCREENER_CACHE_PREFIX` (`cache:screener:`) in
  `src/cache/cache-keys.ts` + export; swept post-commit by
  `EodIngestService.runNightly()` and `PurgeService.purgeUnlicensed()`
  (fail-loud, same as the search/stocks/disclosures prefixes).

### Tests

- `screener-params.spec.ts` (18, unit, no containers): every parse helper
  incl. empty-string/garbage dropping, LEAP board dropping, clamped
  pagination.
- `screener.int.spec.ts` (32, testcontainers Postgres): hand-controlled
  6-company universe (5 MAIN/ACE + 1 LEAP never screened) with deterministic
  winners/losers per filter class — table-driven filter cases, latest-shariah
  flip, NULL-ratio/NULL-sma exclusion, sort matrix (asc/desc × NULLs-last),
  offset/limit + total, per-numeric-class provenance, spec-03 row shape.
- `ingestion.int.spec.ts` (4th test, extended): `cache:screener:*` keys swept
  by the second nightly AND by the purge; keys outside the prefixes survive.

### Notes

- One SQL bug found and fixed by the integration suite: the board filter
  needed `c.board::text = ANY(...)::text[]` (Postgres enum ≠ text operator).
- Glossary: "Screener" entry added to `apps/backend/CONTEXT.md` (incl. the
  query-time-aggregation gap resolution).
