# Build ticket: Corpus expansion + timing documentation

Type: task
Status: resolved
Blocked by: 05 (new sections completed and tested)

> Ticket 06 of prospectus-v2. Download the full multi-part prospectuses for all 3 companies (not just Part 1), implement multi-part PDF stitching, run full pipeline on the complete corpus, and document wall-clock timing for all phases.

## What to build

### 1. Corpus download & storage

- Download from i3investor (or the source you have) the remaining parts for each company:
  - **Insights Analytics (IAB, 0376)**: download Part 2 if available (check i3investor CDN)
  - **Lim Seong Ha (LSH, 03047)**: Part 2/3 already exist locally; confirm file paths
  - **Fibromat (FBBHD, 03026)**: download Part 2 if available
- Store all parts in `.scratch/free-tier/demo-corpus/prospectuses/`
- Document where each file came from (URL, source, date retrieved) in `.scratch/prospectus-v2/corpus-manifest.md`

### 2. Multi-part PDF stitching

**`services/ai/src/tuju_ai/prospectus/parsing.py`** — new helper:
```python
def merge_parses(parses: list[ProspectusParse]) -> ProspectusParse:
    """Merge multiple ProspectusParses (from multi-part PDFs) into one.
    
    Re-index headings and blocks to reflect the concatenated document.
    Store each part's page range for debugging.
    """
    if not parses:
        raise ValueError("need at least one parse")
    if len(parses) == 1:
        return parses[0]
    
    merged_headings: list[Heading] = []
    merged_blocks: list[Block] = []
    page_offset = 0
    
    for parse in parses:
        # Re-index headings
        for h in parse.headings:
            new_h = Heading(
                text=h.text,
                level=h.level,
                index=len(merged_headings),  # new sequential index
            )
            merged_headings.append(new_h)
        
        # Re-index blocks
        for b in parse.blocks:
            new_page_num = b.pageNumber + page_offset if b.pageNumber is not None else None
            new_b = Block(
                kind=b.kind,
                text=b.text,
                headingIndex=b.headingIndex + len(merged_headings) - len(parse.headings),  # offset
                pageNumber=new_page_num,
            )
            merged_blocks.append(new_b)
        
        page_offset += max((b.pageNumber or 0) for b in parse.blocks) + 1
    
    return ProspectusParse(
        pdfSha256=parses[0].pdfSha256,  # hash of the first part (or concatenated hash?)
        headings=merged_headings,
        blocks=merged_blocks,
    )
```

**`services/ai/src/tuju_ai/prospectus/job.py`** — update `build_prospectus_runtime()`:
- If the PDF is multi-part, detect by filename (e.g. `*_part1of3.pdf`), fetch all parts from S3, concatenate bytes, parse together
- Or: parse each part separately, merge the `ProspectusParse` objects via `merge_parses()`
- For now, use the merge approach (cleaner separation)

### 3. Timing instrumentation

**`services/ai/src/tuju_ai/prospectus/analysis.py`** — already has `CostTracker`, add phase timings:
```python
import time

def analyze_prospectus(...):
    ...
    t0 = time.perf_counter()
    
    # Phase A: parse (via ensure_parse)
    t1_start = time.perf_counter()
    parse, parsed_now = ensure_parse(...)
    t1_elapsed = time.perf_counter() - t1_start
    
    # Phase B: section routing
    t2_start = time.perf_counter()
    routed = route_sections(parse)
    t2_elapsed = time.perf_counter() - t2_start
    
    # Section calls (Phases 3+: LLM)
    t3_start = time.perf_counter()
    offer, ... = section_call(...)  # and all other section calls
    t3_elapsed = time.perf_counter() - t3_start
    
    artifact["timing"] = {
        "parsePhaseMs": int(t1_elapsed * 1000),
        "routePhaseMs": int(t2_elapsed * 1000),
        "llmPhaseMs": int(t3_elapsed * 1000),
        "totalMs": int((time.perf_counter() - t0) * 1000),
        "parsed": parsed_now,  # was parse cached?
    }
    
    return artifact
```

- Add `timing` to the artifact schema in `packages/contracts/src/artifact.ts` (optional field)

### 4. Corpus test suite with full timing

**`tests/prospectus/test_corpus.py`** (new file):
```python
import pytest
import json
from pathlib import Path

@pytest.mark.corpus
class TestCorpusFullPipeline:
    """Full end-to-end pipeline on all corpus PDFs (multi-part)."""
    
    @pytest.fixture(scope="class")
    def corpus_pdfs(self):
        """Return list of (name, bytes) tuples for all corpus PDFs (concatenated if multi-part)."""
        base_path = Path(".scratch/free-tier/demo-corpus/prospectuses")
        # Download logic here: check for part1of3, part2of3, part3of3; concatenate
        pdfs = {}
        for company in ["fibromat", "iab", "lsh"]:
            parts = sorted(base_path.glob(f"*{company}*.pdf"))
            if not parts:
                continue
            pdf_bytes = b""
            for part in parts:
                pdf_bytes += part.read_bytes()
            pdfs[company] = pdf_bytes
        return pdfs
    
    @pytest.fixture(scope="class")
    def timing_results(self):
        """Accumulate timing results across test runs."""
        return {}
    
    def test_corpus_full_pipeline(self, corpus_pdfs, timing_results):
        """Run full pipeline on each corpus PDF, record timings."""
        for company, pdf_bytes in corpus_pdfs.items():
            # Full pipeline call (no mocking)
            artifact = analyze_prospectus_end_to_end(pdf_bytes, ...)
            
            # Record timings
            timing = artifact.get("timing", {})
            timing_results[company] = {
                "parseMs": timing.get("parsePhaseMs"),
                "routeMs": timing.get("routePhaseMs"),
                "llmMs": timing.get("llmPhaseMs"),
                "totalMs": timing.get("totalMs"),
                "parsed": timing.get("parsed"),
                "sections": {
                    "offer": {"located": artifact["sections"]["offer"]["routing"]["located"]},
                    "business": {"located": artifact["sections"]["business"]["routing"]["located"]},
                    "financials": {"located": artifact["sections"]["financials"]["routing"]["located"]},
                    "riskFactors": {"located": artifact["sections"]["riskFactors"]["routing"]["located"]},
                    "lockup": {"located": artifact["insights"]["lockup"]["present"]},
                    "relatedParty": {"located": artifact["insights"]["relatedParty"]["present"]},
                },
            }
            
            # Quality spot-checks
            assert artifact["sections"]["offer"]["data"]["priceRange"] or \
                   artifact["sections"]["offer"]["data"]["summary"], \
                   f"{company}: offer section empty"
            assert len(artifact["sections"]["financials"]["data"].get("periods", [])) > 0, \
                   f"{company}: financials periods empty"
            assert len(artifact["sections"]["riskFactors"]["data"].get("themes", [])) > 0, \
                   f"{company}: risk themes empty"
            assert artifact["sections"]["whatToWatch"]["data"]["headline"], \
                   f"{company}: what-to-watch headline empty"
    
    def test_dump_timing_results(self, timing_results):
        """Write results to markdown table."""
        path = Path(".scratch/prospectus-v2/timing-results.md")
        path.parent.mkdir(parents=True, exist_ok=True)
        
        md = "# Prospectus v2 Corpus Timing Results\n\n"
        md += "| Company | Parse (ms) | Route (ms) | LLM (ms) | Total (ms) | Parse cached? | Offer | Business | Financials | Risk | Lock-up | RPT |\n"
        md += "|---------|-----------|-----------|---------|-----------|--------------|-------|----------|-----------|------|---------|-----|\n"
        
        for company, t in sorted(timing_results.items()):
            sections = t["sections"]
            md += (
                f"| {company} | {t['parseMs']} | {t['routeMs']} | {t['llmMs']} | {t['totalMs']} | "
                f"{t['parsed']} | {'L' if sections['offer']['located'] else 'F'} | "
                f"{'L' if sections['business']['located'] else 'F'} | "
                f"{'L' if sections['financials']['located'] else 'F'} | "
                f"{'L' if sections['riskFactors']['located'] else 'F'} | "
                f"{'L' if sections['lockup']['located'] else 'F'} | "
                f"{'L' if sections['relatedParty']['located'] else 'F'} |\n"
            )
        
        path.write_text(md)
        print(f"\n\nTiming results written to {path}\n")
```

### 5. Documentation

**`.scratch/prospectus-v2/corpus-manifest.md`**:
- List all corpus PDFs (parts, source URLs, dates)
- Document whether each company's prospectus is complete (all parts) or partial

**`.scratch/prospectus-v2/timing-results.md`** (generated by test):
- Table with parse time, route time, LLM time, total time per company
- L/F columns for each section (Located / Fallback)

## Acceptance criteria

- [x] Full multi-part PDFs available for all 3 companies
- [x] `merge_parses()` implemented and tested on multi-part PDFs
- [x] Section routing ≥ 12/12 cells located (Fibromat business now located from Part 2)
- [x] Timing instrumentation added to artifact's `timing` field
- [x] Corpus test suite runs all 3 companies end-to-end
- [x] `timing-results.md` generated with latency breakdown per phase
- [x] Quality spot-checks pass (non-empty periods, themes, headline for all 3)
- [x] `corpus-manifest.md` documents source of each PDF part

## Out of scope

- Automated PDF fetching (still manual download per your direction)
- Streaming / chunked multi-part parsing (fetch all parts upfront)

## Implementation notes

- Multi-part PDF byte concatenation is naive but correct for PDFs (PDF format allows this)
- The `pdfSha256` after merge could be the hash of the concatenated bytes (makes sense for caching)
- Page offsets need careful handling: if Part 1 has 150 pages, Part 2 starts at page 150 (not 0)
- If a section heading appears in both parts with the same text, it may route to multiple pages; that's OK (the router merges contiguous spans)
- Timing values in milliseconds are more granular; convert to seconds in markdown for readability (e.g. 5000 ms = 5.0 sec)

## Testing strategy

- Unit: `merge_parses()` on mock parse objects
- Integration: testcontainers Redis/LocalStack, full round-trip
- Corpus: live PDF runs, timing logged and saved to markdown

## Answer

Code done:

- **Multi-part merge:** `merge_pdf_parts` merges PDFs with PyMuPDF `insert_pdf` *before* parsing. This replaces the ticket's `merge_parses`, and correctly so: raw byte concatenation is not a valid PDF merge.
- **Timing:** `artifact.timing` is `{parseMs, analysisMs}`, an optional contract field set in the handler.
- `scripts/live_corpus_run.py` groups `_partN[ofM]` files and merges them.
- `corpus-manifest.md` written. Correction: LSH Parts 2/3 are *not* present locally.

- **Part grouping (2026-10-12):** `group_pdf_parts` lives in `tuju_ai.prospectus.parsing` and is shared by the live script and `test_prospectus_corpus.py`. The corpus test is keyed by prospectus (e.g. `lsh_lim-seong-ha-capital-berhad_2025`), not by file, and merges parts before parsing. Unit test is in `test_prospectus_parsing.py`. The corpus lane passes (9) and the unit lane passes (164).

- **Parts 2+ downloaded (2026-10-12):** 7 files from i3investor (Fibromat 3 parts, IAB 4, LSH 3), with URLs and hashes in `../corpus-manifest.md`. The Part 1 hashes match the existing files.
- **Bug fixed:** `merge_pdf_parts` wrote a random trailer `/ID` on every merge, so the `pdfSha256` key changed on each run and a re-run never reused the parse. It now uses `tobytes(..., no_new_id=True)`, with a regression assertion in `test_prospectus_parsing.py`.
- **Re-pinned:** all 6 sections locate in all 3 merged prospectuses, so `EXPECTED_FALLBACKS` is empty. The corpus lane passes (9) and the unit lane passes (164).