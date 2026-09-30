# Build ticket: Source-adapter seam (interfaces + demo adapter stubs)

Type: task
Status: resolved
Blocked by: 01

> Execution effort breaking down
> [spec 01 — data ingestion + domain model](../../free-tier-specs/01-data-ingestion-and-domain-model.md).
> **Wave 1 — parallelisable with ticket 03 (synthetic generator).** Both depend only
> on ticket 01's committed entities; they converge in the worker (ticket 04).
> Fixed inputs: ADR-0001–0011 (esp. ADR-0002/0004), `apps/backend/CONTEXT.md` glossary,
> the entities in `apps/backend/src/data/entities/`.

## Scope (this ticket only)

The **source-adapter seam**: one TypeScript interface per data class, plus **demo
adapter stubs** that satisfy the interfaces, so consumers read a stable read model
and never know the producer. A later licensed production adapter swaps behind these
with **no consumer change** (spec 01 "Source-adapter seam" section).

This ticket delivers the **contracts + fake/demo implementations wired for DI**, so
they are provably swappable via consumer tests against fakes. It does **not** run any
cron, write to Postgres on a schedule, or compute indicators (that's ticket 04). The
synthetic price/fundamentals *generation logic* is ticket 03 — this ticket defines the
`MarketDataAdapter`/`FundamentalsAdapter` interfaces and a thin demo impl that will
later delegate to ticket 03's generator (stub/placeholder return is fine here; the
seam is what's under test).

### Interfaces (one per data class)

| Adapter | Demo impl (this ticket) | Production impl (later swap) |
| --- | --- | --- |
| `MarketDataAdapter` | `SyntheticMarketDataAdapter` (delegates to gen, ticket 03) | `EodhdMarketDataAdapter` |
| `FundamentalsAdapter` | synthetic, co-generated (ticket 03) | EODHD |
| `DisclosureAdapter` | `AggregatorDisclosureAdapter` (static snapshot) | licensed Bursa feed |
| `NewsAdapter` | `RssNewsAdapter` (headline + link) | RSS / licensed news |
| `ShariahListAdapter` | `ManualShariahListAdapter` (SC-PDF manual) | SC-PDF manual |
| `IpoAdapter` | `ManualIpoAdapter` (manual entry) | manual / semi-automated |

- Each interface returns **plain read models / DTOs** shaped to feed the entities in
  `apps/backend/src/data/entities/` (do not return TypeORM entity instances from
  adapters; the worker persists).
- Each adapter declares the `ProvenanceClass` it produces (`synthetic`/`aggregator`/
  `real`) so the worker can open the correct `IngestionRun` — see `enums.ts`.
- Interfaces live in `apps/backend/src/data/adapters/` (new dir). Register demo impls
  behind DI tokens so a production impl swaps by rebinding one provider.

## Out of scope (other tickets)

- Synthetic co-generation logic + seeded reconciliation — **ticket 03**.
- Ingestion worker process, `@nestjs/schedule` crons, persistence, indicator/ratio
  materialisation, ADR-0012 — **ticket 04**.
- Any read endpoint (specs 02–06).

## Testing seam (TDD)

Unit tests, no live DB (unit lane has no Docker, ADR-0011):

- **Seam contract test:** a consumer given a fake adapter gets the expected read model;
  swapping the fake for a second fake changes only the data, not the consumer — proves
  the production-adapter swap is transparent.
- **Provenance declaration test:** each demo adapter reports the expected
  `ProvenanceClass` (synthetic adapters → `synthetic`, disclosure → `aggregator`,
  reference/manual → as specified).
- **DTO shape test:** adapter outputs carry exactly the fields the corresponding entity
  requires (spot-check `MarketDataAdapter` → `PriceBar` fields, `DisclosureAdapter` →
  `Announcement` fields).

Prior art: `apps/backend` DI/provider tests; `packages/contracts` goldens for shape.

## Answer

Delivered the source-adapter seam: one interface per data class + DI tokens, six demo
implementations bound behind those tokens, and plain read-model DTOs. All new code
lives under `apps/backend/src/data/adapters/` (new dir); no entity, migration, or
other file was touched.

### Files added

- `dto.ts` — plain read-model DTOs (not TypeORM entities): `PriceBarDto`,
  `QuarterlyFinancialsDto`, `FundamentalsDto`, `AnnouncementDto`, `NewsArticleDto`,
  `ShariahStatusDto`, `CorporateActionDto`, `IpoListingDto`. Fields mirror each
  entity's *source* columns (numerics as `number`; worker stringifies at persist,
  and stamps `id`/`createdAt`/`ingestionRunId`/resolved FKs).
- `adapter.interfaces.ts` — `SourceAdapter` base (declares `provenanceClass`) plus
  `MarketDataAdapter`, `FundamentalsAdapter`, `DisclosureAdapter`, `NewsAdapter`,
  `ShariahListAdapter`, `IpoAdapter`, each with a matching injection token
  (`MARKET_DATA_ADAPTER`, `FUNDAMENTALS_ADAPTER`, `DISCLOSURE_ADAPTER`,
  `NEWS_ADAPTER`, `SHARIAH_LIST_ADAPTER`, `IPO_ADAPTER`).
- `demo-adapters.ts` — `SyntheticMarketDataAdapter` + `SyntheticFundamentalsAdapter`
  (`synthetic`, thin placeholder emits — ticket 03 supplies the seeded generator),
  `AggregatorDisclosureAdapter` + `RssNewsAdapter` (`aggregator`),
  `ManualShariahListAdapter` + `ManualIpoAdapter` (`real`).
- `adapters.module.ts` — `AdaptersModule`: binds each demo impl behind its token via
  `useClass` and exports the tokens (the single swap point for a licensed adapter).
- `index.ts` — barrel export.

### Interfaces / provenance

| Interface | Token | Demo impl | ProvenanceClass |
| --- | --- | --- | --- |
| `MarketDataAdapter` | `MARKET_DATA_ADAPTER` | `SyntheticMarketDataAdapter` | `synthetic` |
| `FundamentalsAdapter` | `FUNDAMENTALS_ADAPTER` | `SyntheticFundamentalsAdapter` | `synthetic` |
| `DisclosureAdapter` | `DISCLOSURE_ADAPTER` | `AggregatorDisclosureAdapter` | `aggregator` |
| `NewsAdapter` | `NEWS_ADAPTER` | `RssNewsAdapter` | `aggregator` |
| `ShariahListAdapter` | `SHARIAH_LIST_ADAPTER` | `ManualShariahListAdapter` | `real` |
| `IpoAdapter` | `IPO_ADAPTER` | `ManualIpoAdapter` | `real` |

Adapters return plain DTOs, never entity instances; the worker (ticket 04) persists
and stamps the `IngestionRun`. Synthetic generation logic is intentionally NOT here
(ticket 03) — the placeholders return `[]` so the seam is what is under test.

### Tests added (TDD; unit lane, no live DB)

- `adapter-seam.spec.ts` (2) — a consumer injected against the `MARKET_DATA_ADAPTER`
  token gets the expected read model from a fake; swapping the fake for a second fake
  changes only the data, proving the production-adapter swap is transparent.
- `provenance.spec.ts` (6) — table-driven; each demo adapter resolved from the real
  `AdaptersModule` via its token reports its expected `ProvenanceClass`.
- `dto-shape.spec.ts` (2) — spot-checks `PriceBarDto` → `PriceBar` and
  `AnnouncementDto` → `Announcement` carry exactly the source columns (compile-time
  `Omit<>` mapping + runtime key-set assertions).

### Verification

- `pnpm --filter @tuju/backend typecheck` → exit 0 (clean).
- `pnpm --filter @tuju/backend test` → Test Suites: 6 passed; Tests: 56 passed
  (46 pre-existing + 10 new). No failures introduced.

Left uncommitted in the working tree for review.
