# Decide: the IPO prospectus "at-a-glance" artifact (deep showcase, deferred)

Type: grilling
Status: resolved
Blocked by: 08

## Question

The flagship AI showcase is an **IPO prospectus at-a-glance**, precomputed via the ADR-0005 system-caller path over the demo's manually-curated IPO PDFs ([Decide: how the free tier and the demo showcase AI capabilities](05-ai-showcase.md)). It was **deliberately deferred** behind the shallow artifacts because of the ingestion engineering. This ticket decides the artifact once the ingestion approach is known ([Research: best-in-class ingestion of 500–1000 page documents](08-long-document-ingestion.md)).

Decide:
- **Ingestion approach** to adopt (pick from research ticket 08's recommendation): long-context prompting, layout-parse-to-sections, hierarchical/agentic, contextual RAG, or a hybrid — and the concrete Python-worker job shape under ADR-0007 (new job type, inputs, cached output).
- **The artifact's sections** (agreed starting cut, grill for Bursa-investor fit): (1) the offer — shares, price range, use of proceeds; (2) the business in 3 lines; (3) key financials trend; (4) risk factors, ranked/themed; (5) plain "what to watch". Plus whether to add a Bursa-specific insight (valuation vs. listed peers, Shariah status, cornerstone investors).
- **Output contract**: what the cached result looks like (structured JSON the frontend can render vs. prose), how it's keyed to the IPO, and how it's marked provenance-wise.
- **Cost/latency budget** per prospectus for the demo corpus.

## Notes

- Deferred by design; the shallow artifacts (market brief, announcement summaries) carry the demo's AI breadth while this is built.
- Real, clean input data (stored PDFs) — no synthetic prices, no unlicensed aggregator — so it's the artifact that stands on the firmest ground.


## Answer

Adopts research ticket 08's recommendation and pins the artifact, the wire contract, and the budget. This is the additive prospectus job type ADR-0007 deliberately left unforward-declared ("added additively when it lands").

### 1. Ingestion approach + job shape

**Adopt research 08's primary path unchanged:** Docling parse-to-sections → long-context per-section prompting with prompt caching; whole-doc long-context prompting as the baseline/fallback when the section router can't confidently locate a section. Start on **Gemini 2.5 Flash**, A/B the financials + risk-ranking sections against Pro / Claude Sonnet at build time. No vector store, no reranker, no chunker (deferred until the corpus outgrows one context window).

Concrete job shape under ADR-0007:
- **New BullMQ job name `analyze-prospectus`** on the existing `analysis` queue — additive per ADR-0007 §1; the existing `analyze-technical` / `analyze-fundamental` names are untouched.
- **New payload** (independent, no shared base per ADR-0007 §3): `ProspectusPayload = { prospectusId: string }` — the worker is stateless (ADR-0004) and fetches the stored PDF (S3) + IPO reference row by id; the payload carries only anchoring identity, not bulk data.
- **Docling parse persisted as an S3 claim-check artifact** (ADR-0004), keyed by prospectus, reused across re-runs so re-runs are near-free.
- **Section #5 ("what-to-watch") is a reduce** over the other four section outputs.

### 2. Trigger enum — `system` added to the wire contract (decision, touches `packages/contracts`)

The prospectus job is system-triggered and fits neither existing `trigger` value (`'user' | 'price-move'`). **Add a `'system'` value to the `trigger` enum** in `packages/contracts` (`src/enums.ts`), regenerate TS + JSON Schema + Pydantic. This is a small additive wire-contract change and **also** serves the two shallow AI-showcase artifacts (daily market brief, announcement summaries), which are equally system-triggered — so it's the single enum change that unblocks the whole Shape-B showcase, not just this ticket. Flag for `to-spec`: candidate ADR-0007 amendment (additive `trigger: 'system'`).

### 3. Artifact sections — the five, plus two Bursa-specific insights

The five agreed in ticket 05: (1) **offer** — shares / price range / use of proceeds; (2) **business** in 3 lines; (3) **key financials trend**; (4) **risk factors**, ranked/themed; (5) plain **what-to-watch**.

Plus **two Bursa-specific insights in v1** (both on clean, licence-safe data):
- **Shariah status** — from the real SC Shariah list (map's Shariah source).
- **Cornerstone investors** — extracted from the prospectus itself (real, clean input).

**Peer valuation (valuation vs listed peers) is deferred**, not in v1: it would require peer prices, which in the demo are **synthetic/"illustrative"** (posture decision 04). Resting the flagship artifact's headline insight on fake prices would undercut the whole reason this artifact was chosen — "the only artifact on real, clean, licence-safe data." Revisit when the price adapter swaps to a licensed real-price feed.

### 4. Output contract — structured JSON artifact + thin wire summary, no verdict

Follows the ADR-0007 claim-check pattern exactly:
- **The rich five-section + insights output is structured JSON in the S3 artifact**, whose internal shape is **opaque to the wire contract** (owned by the AI module, evolves freely) — same decoupling ADR-0007 uses for TA/FA.
- **The wire summary is thin and has NO verdict.** A prospectus isn't bullish/bearish, so a `Verdict` enum is wrong here. The prospectus `Summary` is `{ headline, asOf }` where `headline` = the one-line "what to watch". (Flag for `to-spec`: the ADR-0007 `Summary` currently assumes a `verdict`; the prospectus job needs the summary shape to allow a verdict-less variant — an additive contract refinement.)
- **Keyed to the IPO:** the artifact is keyed by `prospectusId`, joined to the manually-curated IPO row.
- **Provenance:** artifact marked `source: real` (stored regulatory PDFs) — the one showcase artifact that is neither synthetic nor unlicensed-aggregator.

### 5. Cost / latency budget

- **Demo corpus = 3 hand-picked recent Bursa IPO prospectuses** (downloaded, see below).
- **Budget ceiling ~$2/doc**, which comfortably allows the A/B of Flash vs Pro/Claude on the financials + risk-ranking sections (research 08 estimates <$0.20/doc on Flash; parse is local/$0-API, minutes of one-time CPU).
- Latency is background/batch (system-triggered JobBus job) — no interactive SLA.

### 6. Corpus sourcing — manual PDFs, NO live scraper (decision 3b)

The prospectus PDF is a public regulatory disclosure, but "public" ≠ "licensed to redistribute". **The spec mandates manually-downloaded, stored PDFs for the demo corpus — no live scraper.** Any automated prospectus fetching is pushed to the same licensed-feed boundary as the aggregator data (architecture [vendor verification task](../../architecture/issues/10-data-vendor-verification.md)). This keeps the flagship artifact's inputs unambiguously clean.

**Downloaded now** into `.scratch/free-tier/demo-corpus/prospectuses/` (verified valid PDFs, `%PDF-` magic, 2.4–2.6 MB each), all real 2025 Bursa **company** IPOs (not ETFs), sourced from i3investor's CDN (research 02 confirmed reachable):
- `iab_insights-analytics-berhad_2025-10-07_part1.pdf` — Insights Analytics Berhad (IAB, 0376), 7 Oct 2025
- `lsh_lim-seong-ha-capital-berhad_2025_part1of3.pdf` — Lim Seong Ha Capital Berhad (LSH, 03047), 2025
- `fbbhd_fibromat-m-berhad_2025-04-11_part1.pdf` — Fibromat (M) Berhad (FBBHD, 03026), 11 Apr 2025

Caveat for the execution effort: these are **Part 1** documents (i3investor splits prospectuses into parts); grab the remaining parts for a complete corpus. Part 1 is sufficient to validate the Docling parse + section-router approach.

### Spec-time flags (for `to-spec`)

- Candidate **ADR-0007 additive amendment**: `trigger: 'system'` value; `analyze-prospectus` job name + `ProspectusPayload`; verdict-less `Summary` variant. All additive, none breaks existing TA/FA.
- The `analyze-prospectus` job is the first job to run **Python in the free-tier ingestion path** (ticket 07 kept Python out of the *demo ingestion* path, but the prospectus artifact explicitly runs on the Python/LangGraph worker per ADR-0004 — no conflict: ticket 07's exclusion was about synthetic price/indicator ingestion, not AI artifacts).
