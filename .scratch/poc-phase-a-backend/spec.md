# Spec: PoC / Phase A — Backend handoff (KLCI 30 + yfinance + reads + system enqueue)

Status: ready-for-agent

> Handoff produced by `to-spec` from the
> [PoC / Phase A backend wayfinder map](map.md).
> Source decisions: tickets
> [01](issues/01-klci30-universe-seed.md)–[06](issues/06-series-analysis-read-routes.md)
> (+ research [01a](issues/01a-klci30-membership-research.md)).
>
> **Scope of this document:** Nest / ingestion-worker **backend** work for PoC
> Phase A — KLCI 30 seed, yfinance adapter binding, ingest + ops cadence,
> analysis-result persistence, system enqueue for `analyze-technical` /
> `analyze-fundamental`, and anonymous series + analysis HTTP (cost-stripped
> artifact proxy). It is **not** a worker LangGraph spec or FE DESIGN ticket
> list — those consume this seam.
>
> **Fixed inputs:** parent [PoC / Phase A overarching](../poc-phase-a/spec.md);
> [contracts handoff](../poc-phase-a-contracts/spec.md) (Zod already the
> consumer contract — do **not** re-open shapes); ADR-0004, ADR-0005, ADR-0007,
> ADR-0012, ADR-0013, ADR-0014; `apps/backend/CONTEXT.md`.
>
> **Planning only:** this map does **not** implement Nest code. Execution is a
> later BE build pass (optionally ticketed below).

## Problem Statement

PoC Phase A product + contracts locks are set (KLCI 30, system-precompute,
descriptive TA/FA, one stock screen, HTTP Zod), but Nest still lacks the
**runtime path**: curated universe seed, real market/fundamentals adapters,
ops commands that materialise data and fan out AI jobs, Postgres claim-check
rows with pending/failed, and the series/analysis routes the FE will hit for
`/stocks/1155`.

## Solution

Pin six BE layers:

1. **`klci30-universe.ts`** — separate PoC seed (not `REFERENCE_UNIVERSE`);
   hard-gate PoC stock/series/analysis to the 30.
2. **`YFinanceMarketDataAdapter` + `YFinanceFundamentalsAdapter`** — env-flag
   DI swap vs synthetic; Redis vendor cache + in-process throttle.
3. **Ops cadence** — `seed-klci` / `ingest-klci` CLI-first; nightly cron on the
   same path when yfinance is bound.
4. **Two analysis tables** — JobBus completion hook is sole writer; always
   upsert status including pending/failed.
5. **`enqueue-klci`** — system fan-out 30×2; skip ready/facts_only same day;
   nightly follow-on after ingest.
6. **HTTP** — extend `stocks.controller`; 404 outside the 30; anonymous
   cost-stripped artifact proxy under `/stocks/:code/analysis/.../artifact`.

## Consumers

| Consumer | Uses |
| --- | --- |
| **Worker map** | Fact assembly + LangGraph for `analyze-technical` / `analyze-fundamental`; signal `facts_only` on grounding strip; never writes Postgres |
| **FE map** | Typed series + thin analysis + proxied rich JSON; demo script `/stocks/1155` |
| **BE execution** | Implement adapters, migrations, stores, routes, worker-main commands named below |
| **Contracts** | Already consumed — HTTP Zod + artifact shapes are fixed inputs |

## Implementation Decisions

### KLCI 30 universe seed (tickets 01 + 01a)

- New module e.g. `apps/backend/src/ingestion/klci30-universe.ts` (TS const
  array only).
- Row fields: `stockCode`, `yahooSymbol`, `shortName`, `fullName`, `board`
  (`Main`), `sectorName`, `aliases` — mirror `ReferenceCompany` + Yahoo.
- Membership refresh: **PR-only** edits of the module (no live scrape).
- PoC HTTP for stock core / series / analysis / artifact **404** for codes
  outside this seed.
- System enqueue fan-out = exactly this list.
- **Concrete 30** (research date 2026-10-09): paste table in
  [01a](issues/01a-klci30-membership-research.md) — uniform `{code}.KL`;
  includes demo exemplar `1155` / MAYBANK. Re-verify vs FTSE/Bursa before any
  non-private use.

### yfinance adapter binding (ticket 02)

| Token | Class | Surfaces |
| --- | --- | --- |
| `MARKET_DATA_ADAPTER` | `YFinanceMarketDataAdapter` | Daily OHLCV → `PriceBarDto[]` |
| `FUNDAMENTALS_ADAPTER` | `YFinanceFundamentalsAdapter` | `.info`, quarterly financials, dividends/actions needed for DY → `FundamentalsDto` |

- `provenanceClass = real`. Synthetic adapters remain for non-PoC
  `DATA_SOURCE=synthetic` (exact env key pinned at build).
- **News stays `RssNewsAdapter`** — no yfinance `.news`.
- Redis vendor cache prefix (e.g. `vendor:yfinance:…`) outside ingest
  `READ_CACHE_PREFIXES` sweep; in-process throttle + 429/5xx backoff.
- Partial failure: **skip + continue** per symbol; ops-visible failure summary
  if any symbol failed.
- Indicators still derived in-house post-ingest (ADR-0012).

### Ingest + ops cadence (ticket 03)

| Command | Role |
| --- | --- |
| `seed-klci` | Upsert Sector / Company / Instrument (+ aliases) from `klci30-universe.ts` |
| `ingest-klci` | Bars → fundamentals → materialise snapshots / indicators for the 30 |
| `enqueue-klci` | System TA/FA fan-out (ticket 05) |

- CLI is the panel checklist; when yfinance DI is bound, existing nightly EOD
  cron exercises the same pull/materialise path.
- Idempotency: **upsert on natural keys**; still open `IngestionRun` for
  lineage.
- Minimum panel prep (Redis/Postgres/S3/API/worker up, yfinance bound):
  1. `seed-klci`
  2. `ingest-klci`
  3. `enqueue-klci`
  4. Wait for jobs → open `/stocks/1155`

### Analysis result persistence (ticket 04)

- Tables: **`technical_analyses`** and **`fundamental_analyses`**.
- Unique key: **`instrument_id`** FK → `Instrument` (CASCADE).
- Columns: `status` (`StockAnalysisStatus`), nullable `headline` / `as_of` /
  artifact bucket+key / `error_message`, `correlation_id`, `job_id`,
  `created_at` / `updated_at`.
- **Writer:** Nest JobBus completion / result hook only (ADR-0004). Prior art:
  `MarketBriefStore`, `ProspectusAnalysisStore`.
- Unlike prospectus: **always upsert status rows** including `pending` /
  `failed` (enqueue creates `pending`; hook sets `running` / `ready` /
  `facts_only` / `failed`).
- `stale`: prior ready/facts_only whose `as_of` is behind latest EOD close day
  for that instrument (compute on read and/or post-ingest — build choice;
  rule is fixed).
- `facts_only`: store the status the worker signals (payload convention →
  worker map).

### System enqueue (ticket 05)

- Command: **`enqueue-klci`** [stockCode] [`--force`].
- Envelope: `trigger`/`requestedBy` = `system`; fresh `correlationId`; TA
  `timeframe: '1D'`; FA `period: 'quarterly'`; `asOf` = wall clock ISO;
  payload symbol = Bursa `stockCode`.
- **Skip (non-force):** row `status ∈ {ready, facts_only}` and
  `as_of`/`updated_at` same **UTC calendar day**.
- Still enqueue missing / pending / running / failed / stale.
- BullMQ `deriveJobId` remains hour-bucketed content id (concurrent collapse);
  day skip is the cost bound.
- On enqueue: upsert analysis row → `pending`.
- Cadence: CLI + **nightly follow-on after successful ingest** when yfinance
  bound. No browser `@RequiresJob` in PoC.
- Per-symbol failures: log + continue the batch.

### Series + analysis HTTP (ticket 06)

Extend **`StocksController`** (anonymous):

| Method | Path | Contract |
| --- | --- | --- |
| GET | `/stocks/:code/series?interval=1d&range=2y` | `StockSeriesResponse` |
| GET | `/stocks/:code/analysis/technical` | `StockTechnicalAnalysisResponse` |
| GET | `/stocks/:code/analysis/fundamental` | `StockFundamentalAnalysisResponse` |
| GET | `/stocks/:code/analysis/technical/artifact` | proxied rich JSON, **`cost` stripped** |
| GET | `/stocks/:code/analysis/fundamental/artifact` | proxied rich JSON, **`cost` stripped** |

- Outside KLCI 30 or unknown code → **404**.
- Series: ~2y EOD bars; empty `points` allowed (200); `demoLabel:
  'private-demo'`; other interval/range → 400.
- Analysis no row → 200 `status: 'pending'` null fields; with row → map store
  (+ optional read-time stale promotion).
- `artifactPath` only when pointer exists:
  `/stocks/{code}/analysis/{technical|fundamental}/artifact`.
- Mirror IPO at-a-glance proxy posture (ADR-0014).

## Out of scope (this handoff)

- LangGraph, prompts, grounding post-check, USD cost ceiling → **worker map**.
- DESIGN.md, chart library, card layout, BM copy → **FE map**.
- Re-shaping `@tuju/contracts` Zod.
- Paid user-triggered enqueue, billing, accounts, watchlist.
- IPO / prospectus in the PoC demo script (existing code may stay).
- Deleting free-tier synthetic pipeline.
- Public-launch data licensing / live KLCI constituent scrape.
- Implementing Nest in the wayfinder map itself.

## Suggested BE execution wave (optional checklist)

Not opened as wayfinder tickets here — agents may tick these in a build map:

1. Add `klci30-universe.ts` from 01a paste; hard-gate helper for PoC routes.
2. Implement yfinance adapters + DI flag + Redis vendor cache/throttle.
3. `seed-klci` / `ingest-klci` worker-main commands + nightly path when bound.
4. Migrations + stores for `technical_analyses` / `fundamental_analyses` +
   JobBus hooks.
5. `enqueue-klci` + nightly follow-on + pending upsert.
6. Series + analysis + artifact routes on `stocks.controller` + tests.

## Acceptance (destination)

- An agent can implement Nest PoC Phase A backend without re-opening product
  or contracts locks.
- Ops demo path is explicit: `seed-klci` → `ingest-klci` → `enqueue-klci` →
  `/stocks/1155`.
- Worker and FE maps know which BE seams they consume and what they must not
  re-decide.
