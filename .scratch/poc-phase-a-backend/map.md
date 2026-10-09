# PoC / Phase A Backend Map — yfinance KLCI 30 + reads + system enqueue

Label: `wayfinder:map`

## Destination

One **backend handoff spec** for PoC Phase A that Nest can execute without
re-opening product or contracts locks: KLCI 30 seed, yfinance adapter binding,
ingest + ops cadence, analysis-result persistence, system enqueue for
`analyze-technical` / `analyze-fundamental`, and anonymous series + analysis
read routes (cost-stripped artifact proxy).

Worker / FE maps consume this; they do not re-shape the JobBus or HTTP Zod.

**Reached:** [spec.md](spec.md) (`ready-for-agent`) — tickets 01–07 resolved.

## Notes

- **Planning only.** Resolve decisions; `to-spec` writes the handoff. No Nest
  code in this map (execution is a later BE build pass).
- **Parent:** [PoC / Phase A overarching](../poc-phase-a/spec.md) — destination
  already reached. Product locks (universe, system trigger, descriptive policy,
  fact defaults, grounding, one-screen blocks) are **fixed inputs**.
- **Contracts:** [PoC Phase A contracts](../poc-phase-a-contracts/spec.md) —
  Zod for TA/FA artifacts + `StockSeriesResponse` / analysis reads already
  landed in `packages/contracts`. Do **not** re-open shapes.
- **Fixed ADRs:** ADR-0004 (Nest sole Postgres writer), ADR-0005 (system
  caller bypasses tier; no browser enqueue in PoC), ADR-0007 / ADR-0013
  (JobBus + system-triggered jobs), ADR-0012 (TS indicators in ingestion
  worker), ADR-0014 (HTTP Zod + claim-check proxy).
- **Context:** `apps/backend/CONTEXT.md`. Prior art: source-adapter seam,
  ingestion worker, `enqueue-prospectus` ops command, `prospectus_analyses`
  store + IPO at-a-glance reads.
- **Skills:** `grilling` for decide tickets; light `research` only if yfinance
  symbol/membership blocks; `to-spec` for the final handoff.
- **Contracts Zod is already merged** — ticket 06 is route/status wiring, not
  schema design.

## Decisions so far

- [Decide: KLCI 30 universe seed](issues/01-klci30-universe-seed.md):
  **Separate `klci30-universe.ts` (not extending `REFERENCE_UNIVERSE`); rows =
  ReferenceCompany fields + `yahooSymbol`; PR-only membership refresh;
  hard-gate PoC stock/series/analysis reads to the 30.** Concrete list via
  research 01a.
- [Research: KLCI 30 membership + Yahoo `.KL`](issues/01a-klci30-membership-research.md):
  **Paste-ready 30 as of 2026-10-09** (Wikipedia constituents + Yahoo
  `shortName` smoke). Uniform `{code}.KL`. Includes `1155` / MAYBANK.
- [Decide: yfinance adapter binding](issues/02-yfinance-adapter-binding.md):
  **`YFinanceMarketDataAdapter` + `YFinanceFundamentalsAdapter`; env-flag DI
  swap vs synthetic; Redis vendor cache + in-process throttle/429 backoff;
  bars + info + quarterly + dividends; skip+continue per symbol; RSS news
  only.**
- [Decide: ingest + ops cadence](issues/03-ingest-ops-cadence.md):
  **`seed-klci` + `ingest-klci` CLI-first; nightly cron uses same path when
  yfinance DI bound; upsert natural keys; enqueue stays ticket 05.**
- [Decide: analysis result persistence](issues/04-analysis-result-persistence.md):
  **Two tables (`technical_analyses` / `fundamental_analyses`) unique on
  `instrument_id`; Nest JobBus completion hook upserts; always upsert status
  incl. pending/failed; `stale` = asOf behind latest EOD close.**
- [Decide: system enqueue TA/FA](issues/05-system-enqueue-ta-fa.md):
  **`enqueue-klci` (+ optional code / `--force`); skip ready/facts_only same
  day; upsert pending on enqueue; CLI + nightly follow-on when yfinance bound.**
- [Decide: series + analysis read routes](issues/06-series-analysis-read-routes.md):
  **Extend `stocks.controller`; 404 outside KLCI 30; series 2y EOD +
  `private-demo`; thin analysis +
  `/stocks/:code/analysis/{technical|fundamental}/artifact` anonymous cost-stripped proxy.**
- [Task: backend to-spec](issues/07-backend-to-spec.md):
  **Handoff written** → [spec.md](spec.md).

## Not yet specified

_(none — destination reached)_

## Out of scope

- LangGraph, prompts, grounding post-check, USD cost ceiling (→ worker map).
- DESIGN.md, chart library, card layout, BM copy (→ FE map).
- Re-shaping `@tuju/contracts` Zod (already decided).
- Paid user-triggered enqueue, billing, accounts, watchlist.
- IPO / prospectus in the PoC demo script (existing code may stay).
- Deleting the free-tier synthetic pipeline (demo-script supersession only).
- Public-launch data licensing / vendor quotes.
- Building Nest code (execution after this map).
