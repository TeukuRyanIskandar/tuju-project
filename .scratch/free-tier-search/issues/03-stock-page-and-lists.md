# Build ticket: Stock page core + disclosure lists (`GET /stocks/:code`)

Type: task
Status: resolved
Blocked by: 01

> Execution effort breaking down
> [spec 02 — search + stock page](../../free-tier-specs/02-search-and-stock-page.md).
> Wave 2 (parallel with ticket 02). Fixed inputs: the spec-01 entities, the
> ticket-01 `ReadCacheService` (`apps/backend/src/cache/`), ADR-0004 (cache
> class 2), ADR-0005 (anonymous), the ticket-10 ratio definitions in
> `apps/backend/CONTEXT.md`.

## Scope (this ticket only)

**Endpoint shape B** — the bounded core stock-page snapshot plus two separate
paginated disclosure lists, in a new `apps/backend/src/stocks/` module
(controller + service + module). No new entity, no migration, no JobBus.

### `GET /stocks/:code` — the core snapshot (one round trip)

Blocks, each with its own `provenance` descriptor read from the block's
source-row `ingestionRunId → IngestionRun.provenanceClass` lineage join:

- **identity** (`real`): `Instrument` (stockCode, shortName, fullName) ⋈
  `Company` (fullName, `board`, `Sector.name`). Unknown code → `NotFoundException`.
- **fundamentals** (`synthetic`): latest `FundamentalsSnapshot` — **ratios are
  read, never recomputed** (P/E, DY, P/NTA, ROE, D/E, PSR as stored; null P/E on
  a loss-maker stays null) **+ `lossMaking: ttmEps <= 0`** derived at read time
  + TTM figures (ttmEps, ttmRevenue, ttmNetProfit, ntaPerShare,
  sharesOutstanding) + `consecutiveGrowthQuarters`.
- **technicals** (`synthetic`): latest `IndicatorSnapshot` — SMA-20/50/200,
  RSI-14, MACD (+signal), 52-wk hi/lo, `latestClose`, and **`%change` computed
  at read time from the two latest `PriceBar`s** (the EOD snapshot — NOT the
  5-min replay; spec: "header close/%change is the EOD snapshot"). Only one
  bar → `%change: null`.
- **shariah** (`real`): latest `ShariahStatus` by `effectiveDate` (status +
  effectiveDate; a company with no row → `null`, still `real` provenance).

A company whose fundamentals/indicator snapshots don't exist yet serves the
identity block with those blocks `null` (graceful, not 404 — only the unknown
code 404s).

### `GET /stocks/:code/announcements?offset=&limit=`

- Newest `filedAt` first; fields straight from the entity: `category`,
  `title`, `filedAt`, `sourceUrl`, `aiSummary` (nullable — spec-06 populates
  it later). **Taxonomy referenced, not redefined** (spec 04 owns it).
- Response `{ items, total, offset, limit }`; `limit` default 50, hard max 100;
  `offset >= 0`. Unknown code → 404.

### `GET /stocks/:code/corporate-actions?offset=&limit=`

- Chronological `exDate` **ascending**; fields: `type`, `exDate`, `amount`
  (nullable). Same pagination shape + rules.

### Cache (class 2, ticket-01 seam)

- Core: key `cache:stocks:<code>:core`.
- Lists: key `cache:stocks:<code>:<list>:<offset>:<limit>`.
- TTL from the service default; nightly ingest + purge invalidate the
  `cache:stocks:` prefix (ticket 01).

### Serialisation

- TypeORM numeric columns are strings — **convert to JS numbers** in the
  payload (`Number(x)`), `null` passthrough. `sharesOutstanding` (bigint) →
  Number (safe at demo scale).
- Every endpoint **anonymous** (no `@RequiresJob`).

### Ownership (parallel-edit rules)

- **Owns:** everything under `src/stocks/` (+ its spec/test files).
- **Does NOT touch:** `app.module.ts` (the orchestrator wires `StocksModule`
  after wave 2), `src/cache/` (read-only consumer), entities/migrations,
  `src/search/` (ticket 02's dir).

## Out of scope (per spec)

- Live intraday header quote (class-3 field — deferred).
- OHLC / chart-data series (charting fog).
- Saved screens / watchlist add-from-page (watchlist fog).
- Rate limiting (cross-cutting fog).
- Spec-04's feed-level endpoints/calendars (market-wide views).

## Testing seam (TDD)

- **Integration via testcontainers Postgres** (ADR-0011; prior art
  `src/ingestion/ingestion.int.spec.ts`):
  - **Composition:** seed one instrument with the full graph (fundamentals +
    indicator snapshots + 2 price bars + shariah + announcements +
    corporate actions, each FK'd to runs of the right provenance class);
    assert the core payload matches the stored ratios exactly (read, not
    recomputed), `%change` = (latest−prev)/prev, `lossMaking` true when
    ttmEps ≤ 0 with P/E null.
  - **Provenance:** each block's `provenance` equals its run's class
    (identity/shariah `real`, fundamentals/technicals `synthetic`, lists
    `aggregator`).
  - **Pagination:** ordering (filedAt desc / exDate asc), offset/limit bounds,
    `total` correctness, 400/429-free clamping (limit>100 → capped or 400 —
    pick one, assert it), unknown code → 404 on all three endpoints.
- Unit tests for pure helpers (serialisation, `%change`, pagination clamping).

## Answer

Implemented as `apps/backend/src/stocks/` (wave-2 parallel agent, then
post-audit nit fix), wired into `AppModule` by the orchestrator.

### Files

- `stocks.types.ts` — payload contracts (blocks + per-block provenance
  descriptors + page envelopes).
- `pagination.ts` — `resolvePagination`: limit default 50, hard clamp 100,
  negative offset → 0, garbage limit → default (clamping, never a 400;
  resolved values echoed in the response so clamped-equivalent requests share
  one cache entry — resolved in the controller before keying).
- `serialisation.ts` — `toNumber` (numeric → JS number, null passthrough) +
  `pctChange` ((latest−prev)/prev×100; one bar → null; prev = 0 → null,
  never NaN).
- `stocks.service.ts` — composition: ratios READ from `FundamentalsSnapshot`
  (never recomputed) + `lossMaking = ttmEps ≤ 0` read-time; `pctChange` from
  the two latest PriceBars (EOD, not the 5-min replay); shariah latest by
  `effectiveDate DESC` (no row → `{ status: null, effectiveDate: null }`,
  provenance stays `real`); provenance per block AND per disclosure item via
  the `ingestionRun` lineage relation; 404 thrown **through** the `remember`
  loader (propagates uncached — no 404 ever cached, no pre-flight query on the
  hot path); sparse company → identity + null blocks.
- `stocks.controller.ts` — the three anonymous routes.
- `stocks.module.ts` — imports `DataModule` + `CacheModule`, plain-provider
  `DataSource` (ingestion DI style).

### Endpoint contracts

- `GET /stocks/:code` → `{ identity, fundamentals, technicals, shariah }`,
  each block carrying `provenance` (identity/shariah `real`,
  fundamentals/technicals `synthetic`).
- `GET /stocks/:code/announcements?offset=&limit=` → `{ items: [{ provenance,
  category, title, filedAt, sourceUrl, aiSummary }], total, offset, limit }` —
  `filedAt DESC` with `id DESC` deterministic tiebreaker (post-audit fix).
- `GET /stocks/:code/corporate-actions?offset=&limit=`` → `{ items: [{ provenance,
  type, exDate, amount }], total, offset, limit }` — `exDate ASC` + `id ASC`.
- Cache keys: `cache:stocks:<code>:core` / `:announcements:<offset>:<limit>` /
  `:corporate-actions:<offset>:<limit>`.

### Tests (21: 11 unit + 7 integration, default lane, real Postgres 16 + Redis 7.4)

Composition matched against stored rows re-read from the DB; loss-maker
(stored null P/E + `lossMaking: true`); sparse-company graceful nulls + empty
pages; ordering/offset/limit/clamp/total on both lists; triple-404; cache
(mutation-invisible proof: rows deleted server-side stay invisible on cached
re-read; repeated unknown-code 404 leaves no key); unit: pagination clamps,
number conversion, null passthrough, pctChange math + zero-prev guard.

### Verification

typecheck clean; 21/21 in the stocks lane; full suite 145/145.
