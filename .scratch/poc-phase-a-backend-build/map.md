# PoC / Phase A Backend Build — Nest execution

Label: `wayfinder:map` (execution)

## Destination

Nest implements the
[PoC Phase A backend handoff](../poc-phase-a-backend/spec.md): KLCI 30 seed,
yfinance adapters, `seed-klci` / `ingest-klci` / `enqueue-klci`, analysis
persistence + JobBus hooks, and anonymous series + analysis HTTP (cost-stripped
artifact proxy). Ops demo path works:
`seed-klci` → `ingest-klci` → `enqueue-klci` → `/stocks/1155`.

## Notes

- **Execution effort.** Decisions are locked in the planning map; this map
  breaks the handoff into build tickets. Code lands in `apps/backend`.
- **Parent handoff:** [poc-phase-a-backend/spec.md](../poc-phase-a-backend/spec.md)
  (`ready-for-agent`). Planning tickets 01–07 resolved.
- **Contracts:** already merged in `packages/contracts` — do **not** re-open
  Zod shapes.
- **Prior art pattern:** [free-tier-search](../free-tier-search/map.md)
  execution map; prospectus ops (`seed-prospectus` / `enqueue-prospectus`),
  JobBus stores, `StocksController`.
- **Out of this map:** worker LangGraph / grounding / `facts_only` wire
  signal; FE DESIGN; deleting synthetic free-tier pipeline.

## Build-time pins (locked before ticket work)

| Pin | Choice |
| --- | --- |
| Yahoo client | `yahoo-finance2` in Nest behind `MARKET_DATA_ADAPTER` / `FUNDAMENTALS_ADAPTER` |
| Env DI | `DATA_SOURCE=synthetic\|yfinance` (default `synthetic`) |
| Vendor cache | Redis prefix `vendor:yfinance:…` outside ingest `READ_CACHE_PREFIXES` sweep |
| JobBus symbol | Bursa `stockCode` in TA/FA payload |
| Artifact proxy | Strip / omit `cost` before returning JSON |
| `facts_only` | Column/enum kept; **hook never writes it yet** — success+`SystemSummary` → `ready`, failure → `failed`, enqueue → `pending` (+ `running` when observed). Worker map pins the wire signal later |
| `stale` | Read-time: prior `ready`/`facts_only` whose `as_of` is behind latest EOD close day |

## Ticket status

| # | Ticket | Wave | Blocked by | Status |
| - | ------ | ---- | ---------- | ------ |
| 01 | [KLCI 30 universe + hard-gate](issues/01-klci30-universe.md) | 1 | — | resolved |
| 02 | [yahoo-finance2 adapters + DATA_SOURCE DI](issues/02-yfinance-adapters.md) | 1 | 01 | resolved |
| 03 | [`seed-klci` / `ingest-klci` + nightly path](issues/03-seed-ingest-ops.md) | 2 | 01, 02 | resolved |
| 04 | [Analysis tables + JobBus hooks](issues/04-analysis-persistence.md) | 2 | — | resolved |
| 05 | [`enqueue-klci` + nightly follow-on](issues/05-enqueue-klci.md) | 3 | 01, 04 | resolved |
| 06 | [Series + analysis + artifact routes](issues/06-series-analysis-http.md) | 3 | 01, 04 | resolved |

## Wave structure

- **Wave 1:** 01 → 02 (universe, then adapters that import it).
- **Wave 2:** 03 (needs 01+02) ∥ 04 (independent migrations/stores).
- **Wave 3:** 05 ∥ 06 (both need 01+04; 05 also wants ingest path from 03 for nightly follow-on).

## Decisions / notes so far

- **01 resolved:** KLCI 30 const + `isKlci30` / `getKlci30Row` in
  [`apps/backend/src/ingestion/klci30-universe.ts`](../../apps/backend/src/ingestion/klci30-universe.ts)
  (paste from 01a; not extending `REFERENCE_UNIVERSE`). See
  [issues/01-klci30-universe.md](issues/01-klci30-universe.md).
- **02 resolved:** `yahoo-finance2` adapters + `DATA_SOURCE` DI — market/
  fundamentals swap (`synthetic` default / `yfinance`); vendor cache
  `vendor:yfinance:…`; throttle + skip+continue. See
  [issues/02-yfinance-adapters.md](issues/02-yfinance-adapters.md).
- **03 resolved:** `KlciSeedService` + `EodIngestService.ingestKlci`;
  `seed-klci` / `ingest-klci` worker-main arms; nightly real-run KLCI path
  when yfinance bound. See
  [issues/03-seed-ingest-ops.md](issues/03-seed-ingest-ops.md).
- **04 resolved:** `technical_analyses` / `fundamental_analyses` + stores +
  JobBus hooks (`ready` / `failed`; never `facts_only`). See
  [issues/04-analysis-persistence.md](issues/04-analysis-persistence.md).
- **05 resolved:** `KlciEnqueueService` + `enqueue-klci`; same-day skip /
  `--force`; pending upsert; nightly follow-on when yfinance (`Real`). See
  [issues/05-enqueue-klci.md](issues/05-enqueue-klci.md) and
  [`klci-enqueue.service.ts`](../../apps/backend/src/ingestion/klci-enqueue.service.ts).
- **06 resolved:** five anonymous routes on `StocksController` — series
  (`BadRequestException` on non-`1d`/`2y`, ~730-day window anchored to the
  latest bar, empty points 200, `private-demo` label), TA/FA thin reads
  (pending-without-row; read-time `stale` promotion vs latest EOD close day),
  and cost-stripped artifact proxies (S3 get + `omitArtifactCost`; the one
  deliberate divergence from IPO prior art). Hard-gate 404 outside KLCI 30 /
  unknown code. Helpers in
  [`stock-analysis-read.ts`](../../apps/backend/src/stocks/stock-analysis-read.ts);
  `StocksModule` +`S3Module`. Also stubbed the ticket-05 `KlciEnqueueService`
  seam in three older ingest harnesses (pre-existing DI break). See
  [issues/06-series-analysis-http.md](issues/06-series-analysis-http.md).

## Out of scope

- LangGraph, prompts, grounding post-check, USD cost ceiling → worker map.
- DESIGN.md, chart library, card layout → FE map.
- Re-shaping `@tuju/contracts`.
- Paid user-triggered enqueue, billing, accounts, watchlist.
- End-to-end rich narrative until worker ships PoC `SystemSummary` + artifacts
  (BE still enqueues; stub worker may not write PoC shapes).
