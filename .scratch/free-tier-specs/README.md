# Free-tier handoff specs — Product A (backend)

Status: ready-for-agent

These are the handoff specs the [free-tier wayfinder map](../free-tier/map.md) was
finding its way to: **backend only**, supporting a **private demo prototype** for
partners and early investors. Each spec is synthesised (via `to-spec`) from the
resolved decision tickets on that map — the decisions are made; these documents are
what an execution effort breaks into build tickets.

Fixed inputs for every spec (do not re-decide): **ADR-0001–0011**, especially
ADR-0002 (two-world monorepo), ADR-0004 (NestJS sole Postgres writer, Python
stateless, 3-class Redis cache), ADR-0005 (free tier = no user-triggered AI jobs;
anonymous browsing; `can()` seam), ADR-0007 (job/result/progress contract).

## The specs

| # | Spec | Reads / owns | JobBus? | Source tickets |
| - | ---- | ------------ | ------- | -------------- |
| 01 | [Data ingestion + domain model](01-data-ingestion-and-domain-model.md) | **owns the shared entities, ingestion worker, adapter seam** | no | 04, 07, 10 |
| 02 | [Search + stock page](02-search-and-stock-page.md) | reads 01; consumes 04's per-company lists | no | 11 |
| 03 | [Screener](03-screener.md) | reads 01 | no | 12 |
| 04 | [Announcements + news + corporate events](04-announcements-news-corporate-events.md) | reads 01; owns `Announcement.aiSummary` | no | 13 |
| 05 | [Market overview](05-market-overview.md) | reads 01; **adds `MarketIndex`/`IndexLevel`/`IndexAdapter`** | no | 14 |
| 06 | [AI showcase + IPO prospectus at-a-glance](06-ai-showcase-and-prospectus.md) | populates 04's `aiSummary`; **touches `packages/contracts`** | **yes** (Python worker) | 05, 08, 09 |

## Build order

1. **Spec 01 first — it blocks everything.** It owns the relational model, the
   ingestion worker process, the source-adapter seam, synthetic co-generation, and the
   ratio/indicator definitions every other spec reads. Nothing else can start until the
   entities and the nightly ingest exist.
2. **Specs 02, 03, 04 in parallel** once 01 lands — each is an independent pure read
   projection over 01's Postgres model. **02 depends on 04** for the per-company
   announcement/corporate-action list shape (build 04's read model before, or alongside,
   02's list endpoints).
3. **Spec 05** after 01 — it adds two entities (`MarketIndex`/`IndexLevel`) and the
   `IndexAdapter`, computed by 01's ingestion worker, so it needs the worker and the
   synthetic constituent bars in place.
4. **Spec 06 last (and independently schedulable)** — it's the only spec that touches
   `packages/contracts` and runs the Python worker. Its shallow artifacts
   (announcement summaries) write into 04's `aiSummary` field, so 04 should exist first;
   the flagship prospectus job is otherwise self-contained on real PDF data.

All read endpoints are **anonymous** and land in **cache class 2** except the
intraday-live market-overview panels (**class 3, Redis-only**). No read endpoint is
class 1 (that's reserved for AI job results).

## Candidate ADRs to write during execution

The map is planning-only and deliberately did **not** create ADRs; two are flagged for
the execution effort to write (numbered after the existing 0001–0011):

1. **ADR-0012 — dedicated NestJS ingestion worker + TypeScript indicators.** A second
   NestJS process (same `apps/backend` codebase/entities) runs all demo ingestion on
   `@nestjs/schedule` crons, and indicators are computed in TypeScript (`trading-signals`)
   rather than TA-Lib-in-Python — a deliberate override of the screener research, keeping
   the whole demo ingestion one-language and Python out of the ingestion path. Flagged by
   [ingestion pipeline shape](../free-tier/issues/07-ingestion-pipeline-shape.md); owned by
   [spec 01](01-data-ingestion-and-domain-model.md). (Hard-to-reverse-ish, surprising
   without context, a real trade-off — meets the ADR bar.)
2. **Additive ADR-0007 amendment — system-triggered AI + prospectus job.** Adds the
   `trigger: 'system'` enum value, the `analyze-prospectus` job name + `ProspectusPayload`,
   and a verdict-less `Summary` variant. All additive; existing TA/FA job types untouched.
   Flagged by [prospectus at-a-glance](../free-tier/issues/09-prospectus-at-a-glance.md);
   owned by [spec 06](06-ai-showcase-and-prospectus.md).

## Deliberately deferred (NOT ready to build — still fog on the map)

These are in scope for the free tier but were **not sharp enough to spec** in this
effort. They surface as "Out of Scope" in the specs above and remain in the map's
["Not yet specified"](../free-tier/map.md). Do **not** infer them from the specs:

- **Charting / OHLC series endpoints** (intervals, ranges, indicator overlays). Indicators
  are a per-symbol *latest* snapshot, not a series; the market-overview `IndexLevel` series
  is the only precedent so far.
- **Anonymous read-API rate-limit / abuse posture.** The cross-cutting question that gates
  every anonymous endpoint (per-endpoint cache class is pinned in each spec; the abuse
  posture is not). This is the single real scaling lever for `/search` and the movers board.
- **Watchlist + accounts behavioural spec.** The entity (`User → Watchlist → Instrument`)
  is fixed in spec 01, but sign-up path, limits, and whether partners get a pre-seeded
  demo account are unspecified.
- **Forward earnings/results calendar** and **structured dealings fields** (buyer/volume/
  price). Both need a licensed forward/structured Bursa feed — pushed to the architecture
  map's vendor-verification task.

## The licence boundary (applies to every spec)

The demo runs on **synthetic-but-labelled** prices/fundamentals and an **unlicensed
aggregator snapshot** for disclosures. Provenance is tracked as `IngestionRun` lineage
(spec 01), so before any public exposure the **decision-B purge** removes every
aggregator/synthetic row and re-sources disclosures from a licensed Bursa feed. Synthetic
prices may stay (relabelled) or swap to a licensed adapter. Production data licensing is
owned by the [architecture map's vendor-verification task](../architecture/issues/10-data-vendor-verification.md),
not by this effort.
