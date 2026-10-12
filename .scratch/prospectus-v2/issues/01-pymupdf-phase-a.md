# Build ticket: PyMuPDF Phase A — structural parse (fast extraction)

Type: task
Status: resolved
Blocked by: — (none; can start immediately)

> Ticket 01 of the prospectus-v2 redesign effort. Replaces Docling's full-document layout ML (10–12 min CPU) with PyMuPDF text/heading extraction (~5–15 sec). No torch, no GPU. The parse is simpler and faster; table extraction moves to a separate Camelot Phase B step.

## What to build

Replace the default parse function with a two-phase architecture: **Phase A** (this ticket) extracts structure via PyMuPDF (native TOC, text blocks, page numbers), and **Phase B** (next ticket) applies Camelot only to the financials section's pages.

- Add `pymupdf>=1.28.0,<2.0.0` to **base** `[project.dependencies]` in `services/ai/pyproject.toml` (small wheel ~30 MB, pure C binding, no transitive torch/display deps)
- New `parse_prospectus_fast(pdf_bytes: bytes) -> ProspectusParse` in `services/ai/src/tuju_ai/prospectus/parsing.py`:
  - `fitz.open(stream=BytesIO(pdf_bytes), filetype="pdf")` → `Document`
  - Extract headings: `doc.get_toc()` returns `[level, text, page]` tuples with native PDF hierarchy levels. If TOC non-empty, use it. If empty, fall back to heuristic: scan text blocks for numerically-prefixed paragraphs (same as current `effective_levels` logic).
  - Extract text blocks: iterate `doc` → for each page, `page.get_text("blocks")` → filter for text blocks (not images), collect in reading order, **store page number on each block**
  - Add new field to `Block` model: `pageNumber: int | None` — will be used by Phase B to target Camelot on specific pages
  - Return `ProspectusParse(pdfSha256=..., headings=[...], blocks=[...])`
- Update `ProspectusParse` model (`services/ai/src/tuju_ai/prospectus/models.py`) to include `pageNumber: int | None` on `Block`
- Update `router.py`:
  - When `fitz.get_toc()` is non-empty, use the native levels directly (no `effective_levels()` call)
  - Keep `effective_levels()` as a fallback only, called when no TOC is available
  - Preserve the continuation-heading logic (`is_continuation` check)
- Wire `parse_prospectus_fast` as the **default** in `job.py`:
  - `ProspectusRuntime.parse_fn` now defaults to `parse_prospectus_fast` (was `parse_prospectus` which uses Docling)
  - Keep `parse_prospectus` in the codebase (legacy, will be in optional `parse-ml` extra for comparison after T03)
- Unit tests in `tests/prospectus/test_parsing.py`:
  - `test_parse_prospectus_fast_with_toc`: mock PDF with a proper TOC, assert `len(headings) > 0`, levels are non-flat
  - `test_parse_prospectus_fast_fallback_no_toc`: mock PDF with no TOC, assert `effective_levels()` is used as fallback
  - `test_block_page_numbers`: verify every `Block` has `pageNumber` set to its source page
  - (Corpus tests are in the next ticket after Camelot is available, since Phase B doesn't make sense standalone)
- Update `pyproject.toml`:
  - Add `pymupdf>=1.28.0,<2.0.0` to base `[project.dependencies]`
  - Keep `docling`, `torch`, `torchvision` in the `parse` extra (unchanged for now; will be renamed to `parse-ml` in T03)
  - Keep existing `dev`, `integration` dependency groups

## Acceptance criteria

- [x] `pymupdf` added to base dependencies (no extras needed)
- [x] `parse_prospectus_fast` implemented, handles both TOC and fallback paths
- [x] `Block.pageNumber` populated for all blocks
- [x] `router.effective_levels()` becomes fallback only (native TOC levels used when available)
- [x] All unit tests pass (`pytest -m unit`)
- [x] Integration tests pass (Redis + LocalStack testcontainers)
- [x] No corpus tests yet (Phase B needed for real PDF validation)

## Out of scope

- Corpus validation (real PDFs tested in T02 after Camelot is wired)
- Timing benchmarks (recorded in T06 after full pipeline is ready)
- Docling removal (stays as optional extra for now)

## Implementation notes

- `fitz.get_toc()` may include non-navigable entries (e.g. page numbers); filter with `level > 0` if needed
- `page.get_text("blocks")` returns (x0, y0, x1, y1, text, block_no, block_type); extract `text` field
- Page numbering in `get_text("blocks")` is 0-indexed in the `Document.page_count` sense
- If a PDF has no text (scanned-only), `get_text("blocks")` will return geometry-only blocks with empty text — filter these out
- The `sha256(pdf_bytes)` key for S3 caching remains unchanged; Phase A/B together produce one `ProspectusParse` per PDF

## Testing strategy (unit lane only)

- Mock PDFs with `pymupdf.open(...)` using in-memory BytesIO (no real files in unit)
- Test the fallback logic (numerically-prefixed sections, continuation headings)
- Verify `pageNumber` is set correctly
- Phase A speed is sub-second on unit mocks; real PDF timing in corpus tests (T06)

## Answer

`parse_prospectus_fast` is the default parse (`handler._default_parse_fn`).

- **TOC path:** implemented as specced. However, **none of the 3 corpus PDFs has a native TOC**, so the planned "use TOC levels" path never runs on real Bursa prospectuses.
- **No-TOC path (`_typographic_parse`):** the regex fallback found 1, 74 and 8 headings and located almost nothing, so it was replaced. A heading is a row that is entirely bold apart from its enumeration span. The heading text keeps its numbering ("2.5 RISK FACTORS") so `effective_levels()` recovers depth.
  - Wrapped headings and wrapped `(Cont'd)` running headers are merged.
  - Running headers are kept as headings, because the router relies on them as chapter boundaries.
  - Page numbers, registration lines and contents pages are dropped.
  - Heading text is echoed as `kind="heading"` blocks (bold table column headers would otherwise vanish). These blocks don't count toward "located".
- **Router fix:** a running header no longer resets `effective_levels()` depth.
- **Speed:** ~1–1.5 s per PDF locally, 0.3–0.6 s in the container.
- **Routing** matches the Docling baseline (see ADR-0015).
- **Tests:** `tests/test_prospectus_parsing.py`, plus the corpus lane pinned in `tests/test_prospectus_corpus.py`.
