# prospectus-v2 parse design rationale: measurements

Supports [ADR-0015](../../docs/adr/0015-prospectus-parse-pymupdf-typographic.md). All numbers were measured on 2026-10-12 against the 3-PDF Part-1 demo corpus. Local runs were on Apple Silicon; container runs used `python:3.12-slim-bookworm`.

## Parse time per PDF

| Parse | Fibromat (141 pp) | IAB (169 pp) | LSH (140 pp) |
|---|---|---|---|
| Docling (spec 06, prior runs) | 4–12 min | 4–12 min | 4–12 min |
| PyMuPDF typographic, local | 1.08 s | 1.48 s | 1.21 s |
| PyMuPDF typographic, in the worker container | 0.40 s | 0.55 s | 0.29 s |
| Camelot on financials pages (rejected) | +0.65 s | +0.58 s | +0.33 s |

## Routing (L = located, F = fallback)

Columns: offer / business / financials / risk-factors / lockup / related-party.

| Parse | Fibromat | IAB | LSH |
|---|---|---|---|
| Docling baseline (4 sections) | L F L L | L L L L | L L L L |
| PyMuPDF, initial regex fallback (as found) | F F F F F F | L F L F F F | F F F F F F |
| PyMuPDF typographic (shipped) | L F L L L F | L L L L L F | L L L L L F |

The F cells in the shipped row are content that lives in Part 2: Fibromat's chapter 7 and every document's chapter 10. The contents page used to "locate" these chapters from dot-leader lines. Skipping contents pages restored the honest fallbacks.

## Why no native TOC

`doc.get_toc()` returns `[]` for all three PDFs. They carry no outline, so TOC-level trust (the plan's main lever) never applies on this corpus. The TOC path is still implemented and unit-tested for PDFs that do have one.

## Why no Camelot

- `lattice` returned 0 tables on every financials page: the tables have no ruling lines.
- The `stream` fallback, as produced on Fibromat p30 and IAB p32:
  - returned page-wide grids whose rows are prose lines ("position of our Group to show the effects of the Public Issue …");
  - split words across columns ("T" | "he gross proceeds of RM43.6 million …");
  - on LSH p37, returned a numeric fragment grid with no labels.
- The planned splice replaced **all** text blocks on any page with a table. Junk tables therefore deleted good prose, including the offer section's "Utilisation of proceeds" text on the shared page.
- PyMuPDF `find_tables()` also returned 0 tables, except one label-less fragment.
- Phase A text for the same table, which is what the LLM now gets:

  ```
  Revenue 45,787 47,953 68,300 75,463
  GP 11,798 10,535 17,136 20,707
  PBT 7,848 5,434 11,229 13,431
  ```

  The bold "FYE 2021 … FYE 2024" header row is kept as a `heading` content block.

## Image size

| Image | Uncompressed | Compressed (pull) |
|---|---|---|
| Docling + CPU torch (spec 06) | ~2.5 GB | n/a |
| PyMuPDF, single-stage | 418 MB | 137 MB |
| PyMuPDF, two-stage, no `uv` in runtime (shipped) | 368 MB | 113 MB |

Docker Desktop's `docker images` shows 556 MB for the single-stage image, because the containerd store double-counts. The figures above are layer sums (`docker history`) and `docker save | gzip`.

Largest packages in the venv:

| Package | Size |
|---|---|
| pymupdf | 64 MB |
| botocore | 31 MB |
| zstandard | 22 MB |
| langsmith | 8 MB |
