# Build ticket: Search endpoint (`GET /search?q=`)

Type: task
Status: resolved
Blocked by: 01

> Execution effort breaking down
> [spec 02 — search + stock page](../../free-tier-specs/02-search-and-stock-page.md).
> Wave 2 (parallel with ticket 03). Fixed inputs: the spec-01 entities
> (`apps/backend/src/data/entities/`), the ticket-01 `ReadCacheService`
> (`apps/backend/src/cache/`), ADR-0004 (cache class 2), ADR-0005 (anonymous
> browsing — no `@RequiresJob`).

## Scope (this ticket only)

The anonymous trigram-ranked instrument search endpoint, in a new
`apps/backend/src/search/` module: `InstrumentSearch` repository seam, its
Postgres/`pg_trgm` implementation, the service + controller + module.

### `InstrumentSearch` repository seam

- Interface `InstrumentSearch { search(query: string, limit: number): Promise<SearchResultRow[]> }`
  in `src/search/instrument-search.interface.ts` — the swappable seam the spec
  names (an external search engine *could* live behind it; not built for).
- One Postgres implementation using TypeORM (QueryBuilder / raw SQL with
  `pg_trgm` `similarity()`), per the spec's rank bands:

  1. **Exact `stockCode`** — always rank 1.
  2. **`stockCode` prefix** (`LIKE 'q%'`).
  3. **Name prefix** (case-insensitive; a `shortName` hit **outranks** a
     `fullName` hit).
  4. **Trigram similarity** — `pg_trgm` `similarity()` desc; short-name over
     full-name on ties.

  **First band with hits wins; within a band, order by the next rule.** The
  GIN trigram indexes already exist (spec-01 boot migration) — no migration.

- **Universe:** the analysed universe — ordinary shares of `MAIN`/`ACE`
  companies (`Company.board IN (MAIN, ACE)` join through `Instrument.company`).
  `LEAP` rows (if any ever appear) are not searchable.
- Empty / whitespace-only query → empty result (or 400; pick one, assert it).
- Normalise the query once (trim; collapse internal whitespace) before ranking.

### Endpoint

- `GET /search?q=` — **anonymous** (no `@RequiresJob`; the global TierGuard
  passes it through). Returns a bounded list of result rows:
  `{ stockCode, shortName, fullName, companyName, board, sectorName }` —
  identity fields only, no prices/fundamentals (those live on the stock page).
- Result cap: a small constant limit (default 20, hard max 100 via `?limit=`);
  the endpoint never streams the whole universe.
- **Cache class 2** via the ticket-01 `ReadCacheService`: key
  `cache:search:<normalised-query>:<limit>`; TTL from the service default.
  The nightly ingest + purge invalidation hooks already clear the prefix.

### Ownership (parallel-edit rules)

- **Owns:** everything under `src/search/` (+ its spec/test files).
- **Does NOT touch:** `app.module.ts` (the orchestrator wires `SearchModule`
  after wave 2), `src/cache/` (read-only consumer), entities/migrations,
  `src/stocks/` (ticket 03's dir).
- Numeric columns are TypeORM strings; the payload here carries identity
  strings only, so no number conversion is needed.

## Out of scope (per spec)

- Announcement/news body full-text search (not a free-tier feature).
- Rate limiting / abuse posture (cross-cutting fog).
- Suggest/autocomplete variants, search-as-you-type debounce (FE concern).
- An external search engine behind the seam (YAGNI; the seam exists).

## Testing seam (TDD)

- **Integration via testcontainers Postgres** (ADR-0011; prior art
  `src/ingestion/ingestion.int.spec.ts`) — the ranking needs a real `pg_trgm`.
  Seed the curated demo universe (`REFERENCE_UNIVERSE`: MAYBANK 1155, CIMB 1023,
  TENAGA 5347, AXIATA 6888, INARI 0200) + a `LEAP` company asserted unsearchable.
  Table-driven ranking tests:
  - `"1155"` → exact-code band, MAYBANK first.
  - `"115"` → code-prefix band (MAYBANK), before any name matches.
  - `"CIMB"`/`"cimb"` → name-prefix band, case-insensitive, shortName hit
    outranks a fullName hit (seed a fullName-prefix competitor to prove it).
  - `"maybnk"` → fuzzy band still finds MAYBANK (`similarity()`).
  - Band precedence: a code-prefix hit outranks a *better* name/fuzzy hit.
- Cache test: second identical call served from Redis (mock or container),
  key normalisation (case/whitespace collapse → same key).
- Module test: `SearchModule` composes (Nest Test harness) without the
  schedule/worker bits.

## Answer

Implemented as `apps/backend/src/search/` (wave-2 parallel agent, then
post-audit nit fix), wired into `AppModule` by the orchestrator.

### Files

- `instrument-search.interface.ts` — `SearchResultRow` + the `InstrumentSearch`
  seam + `INSTRUMENT_SEARCH` DI token (the swappable seam the spec names).
- `instrument-search.pg.ts` — four sequential band queries over a shared base
  (Instrument ⋈ Company ⋈ Sector, `c.board IN (MAIN, ACE)` riding every band):
  1. exact `stock_code =`
  2. code prefix `LIKE 'q%'` (escaped metacharacters; shorter codes first)
  3. name prefix `ILIKE 'q%'` (escaped; shortName over fullName via `name_kind`,
     then similarity, then name asc)
  4. fuzzy `GREATEST(similarity(lower(short),:lq), similarity(lower(full),:lq))
     >= 0.3` desc, short-name similarity breaking ties (`lower()` on both
     sides — pg_trgm similarity is case-sensitive, ILIKE is not)

  **First band with hits wins and is the whole result** (exclusive — lower
  bands never dilute). No new migration — the spec-01 GIN trigram indexes serve
  bands 2–4.
- `search.service.ts` — normalisation (trim + collapse whitespace; empty →
  200 `{ query, items: [] }` without touching the repo), limit clamp
  (default 20, > 100 → 100, garbage → 20 — never a 400), class-2
  `remember()` keyed `cache:search:<lowercased-query>:<limit>` (case-folded so
  `CIMB`/`cimb` share one entry).
- `search.controller.ts` — `GET /search?q=&limit=`, anonymous (no
  `@RequiresJob`), response `{ query, items: SearchResultRow[] }`.
- `search.module.ts` — binds the seam to the pg impl; imports `DataModule` +
  `CacheModule`; no schedule bits (cron-isolation rule).

### Tests (17, default lane, real Postgres container)

11 table-driven ranking cases (exact/prefix/case-insensitive/`MALAYAN`
fullName-only/ACE-searchable/`maybnk`+`CIMBB` fuzzy/LEAP unsearchable by code,
name, and fuzzy/LIKE-metachar literal `1_5` + `1%5` — post-audit fix) + row
shape + repo-level limit + empty-query short-circuit + cache hit (spy proves
no re-query; one key across case/whitespace variants) + limit clamp via spy
args + module-composes (no `@RequiresJob` metadata, no ScheduleModule).

### Post-audit nit fix

The independent audit flagged unescaped LIKE metacharacters
(`1_5` wildcard-matching `1155`) — fixed via `escapeLikePattern()` in bands
2–3 with two new ranking cases.

### Verification

typecheck clean; 17/17 in the search lane; full suite 145/145.
