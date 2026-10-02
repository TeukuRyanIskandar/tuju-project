# Build ticket: Screener fields endpoint (`GET /screener/fields`)

Type: task
Status: resolved
Blocked by: 01

> Wave 2 of the spec-03 execution effort breaking down
> [spec 03 — screener](../../free-tier-specs/03-screener.md).

## What to build

The anonymous `GET /screener/fields` endpoint: advertises the available
screener filters and their enum domains so the FE builds the form without
hardcoding — the filter vocabulary from ticket 01's seam (names, kinds: enum /
numeric band / boolean, which take min/max), the board domain (`MAIN`/`ACE`
from `ListingBoard`), and the sector domain (id + name from the `Sector`
reference table, name-ordered). Class-2 cached under `cache:screener:`
(invalidated by the existing nightly sweep). Deliberately no `@RequiresJob`
(anonymous, ADR-0005).

## Acceptance criteria

- [x] The filter set advertised matches the `GET /screener` params exactly
      (same names/kinds — a drift test guards it against ticket 01's parse
      layer).
- [x] Sector domain read from Postgres (`Sector` reference entity), board
      domain from the enum; both class-2 cached.
- [x] Integration tests through the composed module (testcontainers), prior
      art `search.int.spec.ts`; unit tests for any pure mapping (no containers).

## Out of scope

- `GET /screener` itself (ticket 02 — parallel agent).
- `app.module.ts` wiring of ticket 02's module (orchestrator, post-wave).

## Answer

Implemented as the second route on the existing ticket-02 endpoint trio —
no new module, so no `app.module.ts` wiring needed (the `ScreenerModule`
the orchestrator already wired carries it). All acceptance criteria pinned
by tests; typecheck + build clean; full suite **288/288** across 26 suites
(incl. all testcontainers suites); `test:int` 2/2.

### Files

- `fields.ts` (new, pure) — the advertised vocabulary:
  `SCREENER_FILTER_FIELDS` (a discriminated union on `kind` — enum filters
  point at their `domain` member in the response, boolean filters take one
  `true`/`false` param, numeric bands take `minParam` + `maxParam` with
  `maxParam: null` marking a floor-only filter like `volume`), the
  `ScreenerFieldsResponse` shape, and `SCREENER_FIELDS_CACHE_KEY`
  (`cache:screener:fields` — exactly the suffix ticket 02 reserved).
  Descriptor params are typed `keyof RawScreenerParams`, so an advertisement
  naming a param `GET /screener` does not understand does not compile.
- `params.ts` — the internal picker allowlist hoisted into an exported,
  compile-time-exhaustive `Record<keyof RawScreenerParams, true>` →
  `RAW_SCREENER_PARAM_KEYS` (one home of the HTTP param names: the ticket-02
  picker AND ticket 03's drift guard both read it), plus
  `RAW_SCREENER_NON_FILTER_KEYS` (the sort/dir/offset/limit subset the
  advertisement excludes). No behaviour change — the picker iterates the
  same 29 keys.
- `screener-query.interface.ts` — `ScreenerSectorOption` (id + name; the
  shape's single home — `fields.ts` imports it, per code review) + the
  seam's second method `sectors()`: the sector enum domain, name-ordered.
- `screener-query.pg.ts` — `sectors()`: one plain ordered read over the
  `Sector` reference table. Every sector, whether or not an analysed
  company FKs to it (the domain is the classification, not the populated
  universe).
- `screener.service.ts` — `fields()`: one class-2 entry under the reserved
  `…:fields` key — the static vocabulary + board domain
  (`SCREENER_BOARDS`, i.e. MAIN/ACE from `ListingBoard`) + the seam's
  sector domain, all cached together so a sweep can never serve a
  half-updated advertisement.
- `screener.controller.ts` — the `@Get('fields')` route on the existing
  anonymous controller (no `@RequiresJob`, ADR-0005; takes no params — it
  IS the param vocabulary).

### Tests

- `screener-fields.spec.ts` (6, unit, no containers) — the drift guard:
  the exact descriptor list pinned (a filter cannot appear or vanish
  silently — an FE-contract change must fail this suite first); no
  param overlaps two descriptors; advertised params cover EXACTLY
  `RAW_SCREENER_PARAM_KEYS` minus the page keys; every advertised param
  is LIVE in the parse layer (a probe value through `parseScreenerFilters`
  flips exactly one resolved filter field — catches renames, dropped
  parse branches, and kind changes); board/sector probes land on the right
  domains; the cache key rides the swept prefix exactly as reserved.
- `screener-fields.int.spec.ts` (4, testcontainers Postgres + Redis) —
  through the composed module: route composes + anonymous posture; the
  response carries the pinned vocabulary, the MAIN/ACE board domain, and
  the sector domain name-ordered from Postgres (seeded out of name order;
  ids round-trip to the `Sector` rows the FK filter takes); one exact
  `cache:screener:fields` entry served without re-querying; the
  nightly-ingest prefix sweep invalidates it — a sector ingested after
  caching appears only once swept (class-2 semantics, never half-cached).

### Notes

- No invalidation hooks added — ticket 01's `runNightly()` +
  `purgeUnlicensed()` sweeps already clear `cache:screener:*` (the
  ingestion suite even used `cache:screener:fields` as its example key).
- The fields response is one whole cache entry (filters + boards +
  sectors) rather than per-domain keys: the advertisement is only useful
  as a coherent snapshot, and one key keeps the sweep/rebuild story simple.
