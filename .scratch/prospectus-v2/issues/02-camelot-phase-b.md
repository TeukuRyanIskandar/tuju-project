# Build ticket: Camelot Phase B — targeted financial table extraction

Type: task
Status: resolved
Blocked by: 01 (PyMuPDF Phase A with `Block.pageNumber`)

> Ticket 02 of prospectus-v2. After PyMuPDF Phase A extracts text structure, use Camelot to extract financial tables from the located financials section's page range only. No full-document torch overhead; only targeted pages get high-quality table extraction.

## What to build

- Add `camelot-py>=2.0.0,<3.0.0` to the `parse` extra in `services/ai/pyproject.toml`
  - Camelot 2.0 dropped Docling/torch; it uses `pypdfium2` (3.6 MB) + `opencv-python-headless` (54 MB) + `pillow`, `playa-pdf`
  - No `[ghostscript]` extra needed for digital PDFs (optional fallback for scanned docs)
  - Verify `opencv-python-headless` has no system lib dependencies beyond glibc (shipped in `slim-bookworm` base image)
- New `extract_tables_camelot(pdf_bytes: bytes, page_numbers: list[int]) -> list[Block]` in `services/ai/src/tuju_ai/prospectus/parsing.py`:
  - `import camelot` (only inside the function to keep lazy)
  - Call `camelot.read_pdf(..., pages=page_numbers, flavor="lattice")` (0-indexed, same as PyMuPDF)
  - If 0 tables found with lattice, fall back to `flavor="stream"`
  - Convert each `camelot.Table` to `Block(kind="table", text=<markdown>, pageNumber=...)`:
    - Use `table.to_pandas()` → convert to markdown via `tabulate` or pandas `to_markdown()`
    - Preserve table structure (column headers, row order)
  - Return list of table blocks in page order
- Update `ensure_parse()` in `services/ai/src/tuju_ai/prospectus/store.py`:
  - After Phase A parse + section routing, check if `financials` section is `located=True`
  - If yes, extract page numbers from `financials` blocks (using `Block.pageNumber`)
  - Call `extract_tables_camelot(pdf_bytes, pages=...)` to get table blocks
  - Splice table blocks into the parse, replacing any raw text blocks that overlap with a Camelot table's bounding box (deduplication)
  - If `financials` is `located=False` (fallback whole-document), skip Phase B entirely
  - Return merged `ProspectusParse`
- Unit tests in `tests/prospectus/test_parsing.py`:
  - `test_extract_tables_camelot_lattice`: mock PDF with a structured table, assert lattice mode finds it and converts to markdown
  - `test_extract_tables_camelot_fallback_stream`: mock PDF where lattice fails, assert stream mode is used
  - `test_extract_tables_camelot_empty`: mock PDF with no tables on the given pages, assert empty list returned
  - `test_ensure_parse_with_camelot`: integration of Phase A + Phase B in `ensure_parse`, verify output has table blocks
- Corpus tests in `tests/prospectus/test_parsing.py` with `@pytest.mark.corpus`:
  - `test_corpus_fibromat_financials`: real Fibromat Part 1 PDF, assert `FinancialsOutput.periods` is non-empty after full pipeline
  - `test_corpus_iab_financials`: real IAB PDF, assert financials tables extracted
  - `test_corpus_lsh_financials`: real LSH PDF, assert financials tables extracted
  - Record wall-clock time for Phase A parse, Phase B Camelot, total per PDF
- Update `pyproject.toml` `parse` extra to include `camelot-py>=2.0.0,<3.0.0` (opencv-headless pulled transitively)

## Acceptance criteria

- [x] `camelot-py` added to `parse` extra
- [x] `extract_tables_camelot()` implemented, handles both lattice and stream flavors
- [x] Table blocks deduplicated against text blocks in `ensure_parse()`
- [x] Phase B only runs on located financials section (not on whole-document fallback)
- [x] Unit tests pass (`pytest -m unit`)
- [x] Integration tests pass
- [x] Corpus tests pass: all 3 PDFs produce `FinancialsOutput.periods` with at least one entry
- [x] Wall-clock timing recorded for each phase (Phase A < 30 sec, Phase B Camelot < 60 sec, total < 90 sec per PDF)

## Out of scope

- Full ADR on table extraction strategy (covered in T07)
- Comparison with Docling table quality (Docling stays as optional extra for future benchmarking)

## Implementation notes

- `camelot.read_pdf(..., pages=[1,2,3])` uses 1-indexed page numbers, but PyMuPDF's `Block.pageNumber` is 0-indexed. Convert: `pages=[p+1 for p in page_numbers]`
- `camelot.Table.to_pandas()` returns a DataFrame; use `df.to_markdown()` (pandas >=1.3) or `tabulate.tabulate(df.values, headers=df.columns, tablefmt="github")` for markdown
- Bounding box overlap detection: simple approach is page-level filtering (if a page has a Camelot table, remove all text blocks on that page and replace with table blocks)
- If Camelot finds a table but the markdown is malformed (e.g. all NaN columns), catch and skip: `try: ... except: pass` and fall back to raw text
- `pdf_bytes` passed to both Phase A and Phase B — no re-download needed

## Testing strategy

- Unit: mock PDFs with synthetic tables (use `reportlab` or just byte strings to create minimal valid PDFs)
- Integration: real testcontainers Redis/LocalStack, full round-trip
- Corpus: real 3 PDFs from `.scratch/free-tier/demo-corpus/prospectuses/` — **test only if `parse` extra is installed**
  - Mark with `@pytest.mark.corpus` to allow skipping on CI fast lane
  - Record timing in test output or a `timing.log` file

## Answer

**Dropped by decision (2026-10-12).**

- Camelot produced junk on the corpus' borderless financial tables: `lattice` found 0 tables, and `stream` turned prose into grids.
- The page-level splice then deleted real text, including offer-section prose.
- PyMuPDF `find_tables()` also found nothing.
- Phase A's row-wise text ("Revenue 45,787 47,953 …") is already LLM-readable.

What was removed: `extract_tables_camelot`, the `ensure_parse` splice, their tests, `camelot-py` and opencv. The `parse` extra is gone, and Docling now lives in `parse-ml`. Evidence: `../parse-design-rationale.md`.
