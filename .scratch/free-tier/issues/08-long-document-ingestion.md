# Research: best-in-class ingestion of 500–1000 page documents (beyond classic RAG)

Type: research
Status: resolved
Blocked by: (none)

## Question

The demo's flagship AI artifact is an **IPO prospectus at-a-glance** ([Decide: how the free tier and the demo showcase AI capabilities](05-ai-showcase.md)) over real, manually-curated prospectus PDFs (300–1000 pages). Before we commit to an approach, survey the **current** best methods for ingesting and analysing very long documents, explicitly evaluating alternatives to naive chunk-and-embed RAG.

Cover, for each approach:

- **What it is** and when it wins (accuracy, cost, latency, engineering complexity).
- **Long-context / full-document prompting**: feeding the whole prospectus into a large-context model (e.g. Gemini 1.5/2.x 1M+, Claude 200K, GPT-4.1 long context). Cost per document, context-window fit for 500–1000pp, quality vs. RAG, prompt-caching to amortise repeated section extraction.
- **Structure-aware / layout parsing first**: PDF layout extraction (tables, headings, TOC) before any LLM step — tools like the newer document-AI parsers, and whether prospectuses' regulated structure (Bursa/SC prospectus format) lets us target sections deterministically instead of retrieving them.
- **Hierarchical / agentic summarisation**: map-reduce over sections, "raptor"-style recursive summary trees, agentic retrieval where a model navigates the TOC.
- **Contextual retrieval** (e.g. Anthropic's contextual-embeddings + reranking) if classic RAG is still part of the answer.
- **Hybrid**: layout-parse to sections → long-context or targeted RAG per section.

Anchor to our constraints: **Python stateless worker** (ADR-0004), runs as a **system-triggered JobBus job** under ADR-0007 (bounded, we pay), demo corpus is a **handful** of prospectuses (not thousands — favours simpler/heavier-per-doc methods), and we want the (1) offer (2) business (3) financials trend (4) ranked risk factors (5) what-to-watch sections. Recommend a concrete approach (or 2 to prototype) with rough cost/latency per prospectus and the engineering surface (chunking, vector store, reranker — or none).

Findings land in `docs/research/` per the map's convention, on branch `research/prospectus-ingestion`.


## Answer

**Findings:** `docs/research/0005-prospectus-ingestion.md` on branch
`research/prospectus-ingestion` (worktree at `../tuju-research-prospectus-ingestion`).

**Recommendation — prototype two, ship one:**

1. **Ship: layout-parse-to-sections → long-context section prompting with prompt
   caching.** Parse each prospectus once with **Docling** (pure-Python,
   uv-installable, local, MIT) into a structured `DoclingDocument` (headings,
   reading order, **table structure**). Exploit the **regulated Bursa/SC section
   skeleton** to deterministically route the four regulated outputs (offer,
   business, financials, risk factors) to the right slices — no retrieval, no
   embeddings — then run one long-context LLM call per section with the shared
   doc/system prefix cached. Section #5 ("what-to-watch") is a reduce over the
   other four. Persist the parse as an S3 claim-check artifact (fits ADR-0004).
2. **Baseline/fallback: pure whole-document long-context prompting** (Gemini
   2.5 Flash/Pro, 1M-token window fits any 1000pp prospectus whole; Claude fits
   the ≤~500pp ones). Fastest to stand up; validates the five-section format and
   is the accuracy/cost bar the parse-first path must beat, and the fallback when
   the section router can't confidently locate a section.

**Model:** start on **Gemini 2.5 Flash** (cheapest, whole-doc fits) to validate
end-to-end (~<$0.20/doc estimate); A/B the financials + risk-ranking sections
against **Gemini 2.5 Pro / Claude Sonnet** and keep the accuracy/cost winner.

**Deliberately deferred (no infra now):** classic chunk-and-embed RAG, **RAPTOR**
recursive-tree summarisation, and **contextual retrieval + reranking**. All are
corpus-scale *retrieval* techniques (vector store / reranker / per-doc tree) that
are unjustified for a **handful** of docs that each fit a modern context window —
Anthropic itself says a <200K-token/~500pp knowledge base needs no RAG. Trigger to
revisit: corpus outgrows a single context window, or we add cross-prospectus Q&A.

**Engineering surface of the recommendation:** Docling + a thin heading-based
section router + one LLM client + prompt caching + a Pydantic result contract
(ADR-0007). **No vector store, no reranker, no chunker.** Costs are bounded by the
fixed five-section output; parse-once + caching keeps re-runs near-free.

Prices and per-doc token counts in the findings are estimates flagged
"confirm at build time" against the live provider pricing pages.
