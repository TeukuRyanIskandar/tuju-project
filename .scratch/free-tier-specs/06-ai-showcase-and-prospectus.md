# Spec: Free-tier AI showcase + IPO prospectus at-a-glance (backend)

Status: ready-for-agent

> Handoff spec produced by `to-spec` from the free-tier wayfinder map. Source
> decisions: [AI showcase](../free-tier/issues/05-ai-showcase.md),
> [long-document ingestion research](../free-tier/issues/08-long-document-ingestion.md),
> [prospectus at-a-glance](../free-tier/issues/09-prospectus-at-a-glance.md).
> **Depends on** [Spec 01: data ingestion + domain model](01-data-ingestion-and-domain-model.md)
> and [Spec 04](04-announcements-news-corporate-events.md) (owns the `Announcement.aiSummary`
> field this spec populates). **Touches `packages/contracts`** (additive).

## Problem Statement

Partners and investors need to *see* the platform's AI capability, but ADR-0005 forbids
the free tier from enqueuing user-triggered jobs, and the paid analysis features don't
exist yet. We need AI-generated content that is precomputed by the system, cost-bounded
by us, and — for the flagship artifact — standing on real, licence-safe data rather than
the demo's synthetic prices or unlicensed aggregator snapshots.

## Solution

**Shape B only:** system-generated AI content via ADR-0005's trusted system-caller path,
read by everyone (no user-triggered jobs; ADR-0005 unchanged). A **set** of artifacts:
two shallow *now* — a daily market brief and announcement summaries — plus one deep,
deferred flagship — the **IPO prospectus "at-a-glance"** on manually-curated real PDFs,
produced by a new `analyze-prospectus` Python-worker job using Docling
parse-to-sections → long-context per-section prompting. The wire contract gains an
additive `trigger: 'system'` value and a verdict-less summary variant.

## User Stories

1. As a partner, I want to see AI-generated content in the demo without logging in or
   triggering a job, so that the AI capability is visible on the anonymous path.
2. As an investor, I want a one-screen "at-a-glance" of an IPO prospectus (offer,
   business, financials trend, ranked risks, what-to-watch), so that I grasp a
   300–1000-page document in seconds.
3. As an investor, I want the prospectus at-a-glance to include Shariah status and
   cornerstone investors, so that I get Bursa-specific context.
4. As a user, I want a plain-language daily market brief, so that I get a narrative read
   of the day (clearly on illustrative data).
5. As a user, I want AI summaries of company announcements, so that I understand
   disclosures quickly.
6. As the platform operator, I want AI cost bounded by us (system-triggered, cached),
   so that anonymous access can't run up a bill.
7. As the platform operator, I want the flagship artifact to stand on real, clean,
   licence-safe data, so that it's the artifact I can defend without caveats.
8. As the platform operator, I want the prospectus job additive to the existing job
   contract, so that the TA/FA job types are untouched.

## Implementation Decisions

### Shape (ticket 05)

- **Shape B only.** System-generated content via the ADR-0005 system-caller path; free
  users/anonymous read cached results. **ADR-0005 unchanged** (no per-user quota, no
  demo paid accounts). A rejected (paid features don't exist yet); C rejected (per-user
  quota needless for a private demo).
- **Artifact set:**
  1. **Daily market brief** (shallow, now) — runs on synthetic "illustrative" prices;
     must summarise the synthetic series without dressing fake numbers as market truth.
  2. **Announcement summaries** (shallow, now) — on the demo-only aggregator snapshot;
     lands in spec-04's `Announcement.aiSummary` field.
  3. **IPO prospectus at-a-glance** (deep, the flagship) — the only artifact on real,
     clean, licence-safe data (stored PDFs).
- All three are **system-triggered** → all need the new `trigger: 'system'` value below.

### Wire contract change (ticket 09 — touches `packages/contracts`, additive)

- **Add `'system'` to the `trigger` enum** (`packages/contracts/src/enums.ts`);
  regenerate TS + JSON Schema + Pydantic (`pnpm --filter @tuju/contracts generate`,
  verify the drift gate `check`). Small additive change; serves all three artifacts.
- **Verdict-less summary variant:** the existing ADR-0007 `Summary` assumes a `verdict`;
  a prospectus isn't bullish/bearish. Add a **verdict-less `Summary` variant**
  `{ headline, asOf }` (headline = the "what to watch" line). Additive; TA/FA summaries
  unchanged.

### Prospectus ingestion + job shape (tickets 08, 09)

- **Approach (research 08, adopted unchanged):** Docling parse-to-sections (pure-Python,
  MIT) → long-context per-section prompting with prompt caching, exploiting the
  regulated Bursa/SC section skeleton to route the regulated outputs. Whole-doc
  long-context is the baseline/fallback when the section router can't locate a section.
  **No vector store, no reranker, no chunker** (deferred until the corpus outgrows one
  context window). Start on **Gemini 2.5 Flash**; A/B financials + risk-ranking against
  Pro / Claude Sonnet at build time.
- **Job (additive under ADR-0007):** new BullMQ job name **`analyze-prospectus`** on the
  existing `analysis` queue; existing `analyze-technical`/`analyze-fundamental`
  untouched. Payload **`ProspectusPayload = { prospectusId }`** (worker is stateless per
  ADR-0004; fetches the stored PDF from S3 + the IPO reference row by id).
- **Runs on the Python/LangGraph worker** — the first free-tier Python AI job. No
  conflict with spec 01 (which kept Python out of *synthetic-price* ingestion only).
- **Docling parse persisted as an S3 claim-check** (ADR-0004), keyed by prospectus,
  reused across re-runs (re-runs near-free).

### Artifact contents (ticket 09)

- **Five sections:** (1) offer — shares / price range / use of proceeds; (2) business in
  3 lines; (3) key financials trend; (4) risk factors, ranked/themed; (5) what-to-watch
  (a **reduce** over the other four).
- **Plus two Bursa-specific insights (v1), both on clean data:** Shariah status (from the
  real SC list) and cornerstone investors (extracted from the prospectus itself).
- **Peer valuation deferred** — would rest on synthetic demo prices, undercutting the
  "real clean data" premise; revisit after the price adapter swaps to a licensed feed.

### Output contract (ticket 09 — ADR-0007 claim-check pattern)

- **Rich five-section + insights output = structured JSON in the S3 artifact**, opaque to
  the wire contract (owned by the AI module, evolves freely).
- **Thin wire summary = verdict-less `{ headline, asOf }`** (headline = "what to watch").
- **Keyed by `prospectusId`**, joined to the manually-curated IPO row.
- **Provenance `source: real`** — the one showcase artifact that is neither synthetic nor
  aggregator.

### Corpus (ticket 09 — manual, no scraper)

- **Manually-downloaded, stored PDFs; no live scraper.** Automated fetching is pushed to
  the licensed-feed boundary (architecture vendor-verification task). Three real 2025
  Bursa company IPOs already downloaded to `.scratch/free-tier/demo-corpus/prospectuses/`
  (IAB 0376, LSH 03047, Fibromat 03026). **Caveat:** these are Part-1 documents
  (i3investor splits by part); the execution effort should grab the remaining parts for a
  complete corpus (Part 1 suffices to validate the parse + section router).

### Cost / latency budget (ticket 09)

- **~$2/doc ceiling** (research 08 estimates <$0.20/doc on Flash; parse is local CPU),
  comfortably allowing the Flash-vs-Pro/Claude A/B on financials + risk ranking.
- Latency is background/batch (system-triggered) — no interactive SLA.

### Read endpoints

- The at-a-glance is read from the S3 artifact (via the existing result-store pattern),
  keyed by `prospectusId`, joined to the IPO row (anonymous read).
- The daily market brief and announcement summaries are read from their cached results
  (`Announcement.aiSummary` for the latter, spec 04).

## Testing Decisions

- **Good test = external behaviour** (job enqueues, produces the artifact shape, wire
  summary is verdict-less, provenance `real`), not prompt internals.
- **Contract tests:** the additive `trigger: 'system'` and verdict-less `Summary` variant
  regenerate cleanly and pass the drift gate; existing TA/FA contract goldens unchanged.
- **Job round-trip (integration, testcontainers + Redis, ADR-0011):** enqueue
  `analyze-prospectus` with a `prospectusId`; assert the worker fetches the PDF, persists
  a Docling S3 claim-check, and emits a `{ headline, asOf }` summary with `source: real`.
- **Section-router test:** on a sample prospectus, assert each of the five sections is
  located/produced and what-to-watch reduces over the others.
- **Idempotence/re-run test:** re-running reuses the persisted parse (near-free).
- **Cost guard:** a build-time check the per-doc token budget stays under the ceiling.
- Prior art: `packages/contracts` goldens; `services/ai` worker tests; jobbus/analysis
  round-trip tests.

## Out of Scope

- **Automated prospectus fetching** (scraper/auto-download) — ruled out of this effort;
  a production-licensing question (architecture vendor-verification task).
- **Peer valuation insight** — deferred (rests on synthetic prices).
- **Paid TA/FA analysis features themselves** — separate product efforts; this spec only
  surfaces the free-tier/demo AI content.
- **RAPTOR / contextual-retrieval / vector store** — deferred until the corpus outgrows
  one context window.
- **User-triggered AI jobs / metered quotas** — rejected (ADR-0005 unchanged).

## Further Notes

- **Candidate ADR (flagged by ticket 09):** an **additive ADR-0007 amendment** capturing
  the `trigger: 'system'` value, the `analyze-prospectus` job + `ProspectusPayload`, and
  the verdict-less `Summary` variant. All additive; none breaks existing TA/FA. Write
  this amendment as part of executing this spec.
- The daily market brief's honesty caveat (narrating synthetic numbers) is a product
  concern flagged in ticket 05 — keep the "illustrative" framing prominent.
