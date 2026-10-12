# Documentation: ADR-0015 — Parse architecture redesign

Type: documentation
Status: resolved
Blocked by: 06 (all implementation complete)

> Ticket 07 of prospectus-v2. Document the architecture decision to replace Docling full-document parsing with PyMuPDF + Camelot two-phase parsing. Record the rationale, trade-offs, and results.

## What to write

Create `docs/adr/0015-prospectus-parse-two-phase.md` (following the ADR template from existing files like 0001–0014).

### Structure:

```markdown
# ADR-0015: Two-phase prospectus parse — PyMuPDF + targeted Camelot

## Status

Accepted (implemented in prospectus-v2 feature branch).

## Context

The flagship prospectus-at-a-glance artifact (spec 06, ADR-0013) uses Docling's full-document layout ML parse to extract text, tables, and heading hierarchy from PDFs. This works correctly but is slow: **~10–12 minutes per 300–600 page PDF on CPU**, dominated by `TableFormer` table-structure recovery on every page.

The parse time bottleneck makes the feature unsuitable for real-world corpus scale (20+ documents = 3+ hours) and a poor experience in development (10 min per iteration).

## Decision

Replace Docling with a **two-phase parse architecture**:

1. **Phase A (PyMuPDF)**: Fast structural extraction
   - Extract headings from native PDF Table-of-Contents (native levels preserved)
   - Extract text blocks in reading order, labeled with page numbers
   - Fallback to heading-level heuristic if TOC missing
   - Time: ~5–15 sec per PDF

2. **Phase B (Camelot)**: Targeted high-quality table extraction
   - Only invoke on the page range of the located `financials` section
   - Extract tables using `lattice` flavor (ML-based line detection)
   - Fall back to `stream` flavor (whitespace heuristic) if lattice finds nothing
   - Splice table blocks into the parse, deduplicating against raw text blocks
   - Skip entirely if financials section is not located (whole-document fallback)
   - Time: ~10–30 sec on financials pages only (~15–20 pages)

**Total parse time: ~1–2 min per document** (vs. 10–12 min with Docling).

The section router (`skeleton.py`) gains native heading levels from Phase A and now uses them directly, removing the need for the `effective_levels()` heuristic in the happy path (heuristic becomes fallback only).

## Rationale

- **Speed**: Docling's ML models on CPU process ~20–25 pages/min. For a 300-page Part-1 + 300-page Part-2 prospectus (600 pages), that's 24–30 min. The two-phase split reduces to ~1–2 min because:
  - PyMuPDF has no ML and runs at ~100–150 pages/sec on plain text extraction
  - Camelot (also no ML on tables) runs ~50–80 pages/min but is only invoked on 15–20 pages (financials section)
  - LLM analysis (8 calls) dominates the timeline after parse (~1–2 min on free tier models)

- **Scalability**: enables corpus expansion from 3 PDFs to 20+ without multi-hour batch windows

- **Docker image size**: Docling + CPU torch = ~2.5 GB. PyMuPDF + Camelot = ~350 MB (opencv-headless is 54 MB, order-of-magnitude smaller than torch wheels). Enables lean worker image split (~300 MB for TA/FA jobs) vs. parse worker (~400 MB).

- **Table quality trade-off**: Camelot F1 ~0.83 vs. Docling F1 ~0.98 on financial tables. Acceptable because:
  - Corpus consists of born-digital, well-formatted Bursa prospectuses (not scanned documents)
  - Table quality loss is minimal for the `FinancialsOutput` task (extract periods, trend, highlights — not a full reverse-engineering of the statement)
  - Docling stays available as optional `parse-ml` extra for future GPU-based or comparison use

## Consequences

### Positive

- ✅ Parse time: ~10 min → ~1–2 min per document (5–10x faster)
- ✅ Docker image (parse worker): ~2.5 GB → ~350 MB (7x smaller)
- ✅ Enables corpus scaling without batch-time explosion
- ✅ Native PDF heading levels eliminate the `effective_levels()` heuristic for well-formed PDFs
- ✅ Camelot tables sufficient for financial analysis use case
- ✅ PyMuPDF + Camelot are pure-Python, no torch GPU requirements for CPU-only deployment

### Negative

- ❌ Table extraction accuracy: Camelot F1 ~0.83 vs. Docling F1 ~0.98
  - Mitigation: Camelot is still strong for financial/structured documents; Docling available as optional extra if quality becomes a blocker
- ❌ Heading hierarchy: PyMuPDF's TOC is PDF-native but may be incomplete on poorly-formed prospectuses
  - Mitigation: `effective_levels()` fallback for PDFs with missing or malformed TOC
- ❌ Multi-part PDF stitching: prospectuses split across parts require custom merge logic
  - Mitigation: `merge_parses()` utility implemented; page offsets carefully managed
- ❌ Free model variance: `openrouter/free` selects model at request time; output may vary on retry
  - Mitigation: validated on 3 corpus PDFs; quality acceptable for showcase; no paid-model fallback (no credits available)

## Implementation

- Ticket 01: PyMuPDF Phase A (native TOC + text extraction)
- Ticket 02: Camelot Phase B (targeted financial table extraction)
- Ticket 03: Docker image split (lean + parse workers)
- Ticket 04: Model config (openrouter/free, live validation)
- Ticket 05: New sections (lock-up, related-party transactions)
- Ticket 06: Corpus expansion (multi-part stitching, timing documentation)

## Alternatives considered

### 1. Keep Docling, run on GPU
- Pro: ML-quality table extraction without change
- Con: Requires GPU instance (expensive, breaks CPU-only deployment); parse time still multi-minute even on GPU
- Rejected: GPU unavailable in current infrastructure; modest time savings don't justify the cost

### 2. Use LlamaParse API for tables
- Pro: Excellent table accuracy; cloud-hosted so no local compute cost
- Con: API cost ($0.003–$0.005/page) = ~$1.50–$2.50 per prospectus, adds external vendor dependency
- Rejected for v2: Camelot F1 ~0.83 acceptable for now; LlamaParse remains escape hatch if Camelot quality degrades at scale

### 3. ColPali vision-based page retrieval
- Pro: Retrieves page images directly; bypasses table extraction entirely for complex layouts
- Con: Requires GPU for embedding (~10 GB VRAM); high model complexity
- Rejected: Wrong scale and wrong hardware tier for current corpus size

### 4. Naive text-only parsing (no tables)
- Pro: Simplest, fastest (~5 sec total)
- Con: Financials section becomes unintelligible (all table structure lost)
- Rejected: Financials are material for investor decisions; table extraction necessary

## Validation

Three 2025 Bursa prospectuses (IAB, LSH, Fibromat) tested end-to-end:
- Parse time (combined Phase A + B): ~1–2 min per document ✅
- Section routing: 12/12 cells located (after multi-part stitching) ✅
- LLM output quality: `FinancialsOutput.periods` non-empty, `RiskOutput.themes` ranked, `WatchOutput.headline` present ✅
- Cost: $0 (openrouter/free tier) ✅
- Image size: parse worker ~350 MB, lean worker ~300 MB ✅

See `.scratch/prospectus-v2/timing-results.md` for detailed timing per phase and company.

## Comparison to prior art

- **Tegus / AlphaSense (production)**: Similar two-stage approach — parse once, then targeted extraction per section
- **sec-edgar-downloader** (open source): Full document, then RAPTOR tree summarization. More complex; justified for long-term retrieval. Overkill for current feature.
- **unstructured.io**: Full-document chunker with optional OCR. Heavier than our approach; designed for heterogeneous document types.

## Future work

- **ColPali**: If Camelot table quality proves insufficient on expanded corpus, implement vision-based page-level retrieval with ColPali (requires GPU, separate model serving)
- **LlamaParse integration**: Wire behind the `ParseFn` seam as a fallback for specific section quality gates
- **Docling GPU path**: If GPU becomes available, enable Docling as an opt-in high-accuracy parse mode
- **Heading hierarchy ML**: If PDF TOC is consistently malformed, train a small classifier to recover hierarchy from text structure

---

Related: ADR-0004 (S3 claim-check), ADR-0007 (job contract), ADR-0013 (system-triggered AI jobs), spec-06 (prospectus artifact).
```

### Additional artifacts:

Create `.scratch/prospectus-v2/parse-design-rationale.md` with deeper technical justification:
- Benchmark table: Docling vs. PyMuPDF vs. Camelot on financial documents (F1, speed, size)
- Cost breakdown: torch wheels (900 MB), opencv (54 MB), pymupdf (30 MB)
- Timing breakdown: Phase A per-page, Phase B full run, LLM calls
- Section routing accuracy before/after (effective_levels heuristic elimination)

## Acceptance criteria

- [x] ADR-0015 written following existing ADR format
- [x] Context and decision clearly stated
- [x] Consequences (positive/negative) enumerated
- [x] Rationale references concrete benchmarks from corpus testing
- [x] Alternatives considered with rejection reasons
- [x] Validation section cites the 3 corpus PDFs + timing results
- [x] Design rationale doc provides technical deep dive
- [x] ADR file saved to `docs/adr/0015-prospectus-parse-two-phase.md`

## Out of scope

- Update ARCHITECTURE.md (may be done in parallel)
- Retrospective on why Docling was chosen initially (covered in spec-06 research ticket 08)

## Time estimate

- ADR write: ~2 hours (review existing ADRs, synthesize decision + consequences)
- Design rationale doc: ~1 hour

## Answer

Written as `docs/adr/0015-prospectus-parse-pymupdf-typographic.md` (not the ticket's draft name, because the decision changed). It records what shipped and what was measured. Measurements are in `../parse-design-rationale.md`. Live free-model validation is marked pending.
