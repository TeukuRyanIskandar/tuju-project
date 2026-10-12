"""PDF parsing adapters (prospectus-v2 ticket 01 + original Docling).

Two parse paths:

1. **parse_prospectus_fast()** (default) — PyMuPDF extraction:
   - Headings from the native PDF Table of Contents when present, else from
     typography (bold rows + their numbering), no ML, ~1–2 sec per PDF
   - Text blocks in reading order, each with its 0-indexed source page

2. **parse_prospectus()** (legacy, Docling) — full-document layout ML:
   - Table-structure recovery via TableFormer
   - Slower (~10–12 min) but available as the optional ``parse-ml`` extra for
     comparison

The :class:`ProspectusParse` schema is compatible between both paths.
"""

from __future__ import annotations

import re
from hashlib import sha256
from pathlib import Path

from .models import Block, Heading, ProspectusParse


def parse_prospectus_fast(pdf_bytes: bytes) -> ProspectusParse:
    """Fast structural PDF extraction via PyMuPDF (prospectus-v2 T01).

    Headings come from the PDF's native Table of Contents (true hierarchy
    levels, ``headingsFromToc=True``) when it has one. None of the demo-corpus
    Bursa prospectuses do, so the no-TOC path recovers headings from
    typography instead (:func:`_typographic_parse`). Every block carries its
    0-indexed source page.

    Runtime: seconds per PDF (vs. 10–12 min for Docling). No torch dependency.
    """
    import pymupdf

    pdf_sha256 = sha256(pdf_bytes).hexdigest()
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        toc = [entry for entry in doc.get_toc() if (entry[1] or "").strip()]
        if toc:
            headings, blocks = _toc_parse(doc, toc)
        else:
            headings, blocks = _typographic_parse(doc)
    finally:
        doc.close()
    return ProspectusParse(
        pdfSha256=pdf_sha256,
        headings=headings,
        blocks=blocks,
        headingsFromToc=bool(toc),
    )


def merge_pdf_parts(parts: list[bytes]) -> bytes:
    """Merge a multi-part prospectus (Part 1 of 3, ...) into ONE PDF, in order.

    Bursa prospectuses are often published in parts; merging the PDFs before
    parsing keeps pages, headings and the ``pdfSha256`` idempotency key
    continuous, so the parse/router need no multi-part logic. (Concatenating
    the raw bytes is NOT a valid merge: a reader follows only the last part's
    cross-reference table.) The merge is deterministic, so the same parts give
    the same bytes and therefore the same ``pdfSha256``.
    """
    import pymupdf

    if not parts:
        raise ValueError("need at least one PDF part")
    if len(parts) == 1:
        return parts[0]
    merged = pymupdf.open()
    try:
        for part in parts:
            with pymupdf.open(stream=part, filetype="pdf") as doc:
                merged.insert_pdf(doc)
        # no_new_id: a fresh random trailer /ID per save would change the bytes,
        # and with them the pdfSha256 idempotency key, on every re-run.
        return merged.tobytes(garbage=1, deflate=True, no_new_id=True)
    finally:
        merged.close()


_PART_SUFFIX = re.compile(r"_part(\d+)(?:of\d+)?$", re.IGNORECASE)


def group_pdf_parts(pdfs: list[Path]) -> dict[str, list[Path]]:
    """Group part files into prospectuses, parts in order, for ``merge_pdf_parts``:
    ``x_part1of3.pdf`` + ``x_part2of3.pdf`` → ``{"x": [part1, part2]}``.
    A file without a ``_partN`` suffix is a one-part prospectus.
    """
    groups: dict[str, list[Path]] = {}
    for pdf in pdfs:
        groups.setdefault(_PART_SUFFIX.sub("", pdf.stem), []).append(pdf)
    for parts in groups.values():
        parts.sort(key=lambda p: int(m.group(1)) if (m := _PART_SUFFIX.search(p.stem)) else 0)
    return groups


def _toc_parse(doc, toc: list) -> tuple[list[Heading], list[Block]]:
    """Headings straight from the native TOC; a block belongs to the most
    recent heading whose start page is at or before the block's page."""
    headings: list[Heading] = []
    # (0-indexed start page, heading index) in document order; get_toc()
    # pages are 1-indexed.
    heading_starts: list[tuple[int, int]] = []
    for level, text, page in toc:
        headings.append(
            Heading(text=text.strip(), level=max(level, 1), index=len(headings))
        )
        heading_starts.append((max(page - 1, 0), len(headings) - 1))

    blocks: list[Block] = []
    start_pointer = 0
    current_heading = -1
    for page_num in range(len(doc)):
        while (
            start_pointer < len(heading_starts)
            and heading_starts[start_pointer][0] <= page_num
        ):
            current_heading = heading_starts[start_pointer][1]
            start_pointer += 1

        for _x0, _y0, _x1, _y1, text, _no, block_type in doc[page_num].get_text(
            "blocks"
        ):
            text = (text or "").strip()
            if not text or block_type != 0:
                continue
            blocks.append(
                Block(
                    kind="text",
                    text=text,
                    headingIndex=current_heading,
                    pageNumber=page_num,
                )
            )
    return headings, blocks


# A row's leading enumeration token, laid out as its own span left of the
# title on the same baseline: "2." / "2.5" / "(b)" / "(iii)".
_ENUMERATION = re.compile(r"^(?:\d+(?:\.\d+)*\.?|\([a-z0-9]{1,5}\))$", re.IGNORECASE)
# Page furniture repeated on every page.
_FURNITURE = re.compile(r"^(?:\d{1,4}|registration no\..*)$", re.IGNORECASE)
# The contents pages list every chapter heading (bold) above dot-leader
# lines; left in, each listed chapter "locates" with only its contents lines.
_CONTENTS_PAGE = re.compile(r"^\s*(?:table of )?contents\b", re.IGNORECASE | re.MULTILINE)
_MAX_HEADING_CHARS = 200
_ROW_Y_TOLERANCE = 3.0


def _is_bold(span: dict) -> bool:
    return bool(span["flags"] & 16) or "bold" in span["font"].lower()


def _rows(block: dict) -> list[list[dict]]:
    """Group a block's spans into visual rows (same baseline, left to right):
    the enumeration and the title of a heading are separate PDF lines."""
    rows: list[tuple[float, list[dict]]] = []
    for line in block.get("lines", []):
        y = line["bbox"][1]
        spans = [s for s in line["spans"] if s["text"].strip()]
        if not spans:
            continue
        if rows and abs(rows[-1][0] - y) <= _ROW_Y_TOLERANCE:
            rows[-1][1].extend(spans)
        else:
            rows.append((y, spans))
    return [
        sorted(spans, key=lambda s: s["bbox"][0]) for _y, spans in rows
    ]


def _row_text(spans: list[dict]) -> str:
    return " ".join(" ".join(s["text"].split()) for s in spans).strip()


def _heading_row(spans: list[dict]) -> bool:
    """A heading row: its title (everything after an optional enumeration
    span) is entirely bold, short, and carries words — not a bold number or
    a bold inline phrase inside a regular sentence."""
    title = spans[1:] if _ENUMERATION.match(spans[0]["text"].strip()) else spans
    if not title or not all(_is_bold(s) for s in title):
        return False
    text = _row_text(title)
    return len(text) <= _MAX_HEADING_CHARS and sum(c.isalpha() for c in text) >= 2


def _starts_enumerated(spans: list[dict]) -> bool:
    return len(spans) > 1 and bool(_ENUMERATION.match(spans[0]["text"].strip()))


def _typographic_parse(doc) -> tuple[list[Heading], list[Block]]:
    """No-TOC fallback: headings recovered from typography.

    Bursa prospectuses set headings in the body font size but bold, with the
    section number as a separate span on the same baseline. Each bold row
    (consecutive bold rows = one wrapped heading, unless the next row starts
    its own enumeration) becomes a level-1 heading whose text KEEPS its
    numbering ("2.5 RISK FACTORS") so the router's ``effective_levels()``
    recovers depth from it, exactly as it does for Docling's flat levels.
    Page-break running headers ("2. PROSPECTUS SUMMARY (Cont'd)", title not
    bold) are kept as headings like Docling did: the router treats them as
    transparent inside a subsection, but they still close a sibling chapter
    whose own opening heading was missed. Page numbers, registration lines
    and the table-of-contents pages are dropped as furniture.
    """
    from .router import is_continuation

    headings: list[Heading] = []
    blocks: list[Block] = []
    current_heading = -1

    for page_num, page in enumerate(doc):
        if _CONTENTS_PAGE.search(page.get_text()):
            continue
        for block in page.get_text("dict")["blocks"]:
            if block.get("type") != 0:
                continue
            pending_heading: list[str] = []
            body: list[str] = []

            def flush_body() -> None:
                if body:
                    blocks.append(
                        Block(
                            kind="text",
                            text="\n".join(body),
                            headingIndex=current_heading,
                            pageNumber=page_num,
                        )
                    )
                    body.clear()

            def flush_heading() -> None:
                nonlocal current_heading
                if pending_heading:
                    text = " ".join(pending_heading)
                    pending_heading.clear()
                    headings.append(Heading(text=text, level=1, index=len(headings)))
                    current_heading = len(headings) - 1
                    # Also as content: bold rows include table column headers
                    # ("FYE 2021 FYE 2022 ...") and sub-headings the section
                    # prompts need; the router's content is blocks only.
                    blocks.append(
                        Block(
                            kind="heading",
                            text=text,
                            headingIndex=current_heading,
                            pageNumber=page_num,
                        )
                    )

            for spans in _rows(block):
                text = _row_text(spans)
                if is_continuation(text):
                    # A running header's title is NOT bold, and it may wrap
                    # ("... DIRECTORS" / "AND KEY SENIOR MANAGEMENT (Cont'd)"):
                    # close it as one heading with any pending first row.
                    flush_body()
                    pending_heading.append(text)
                    flush_heading()
                    continue
                if _FURNITURE.match(text):
                    flush_heading()
                    continue
                if _heading_row(spans):
                    flush_body()
                    if pending_heading and _starts_enumerated(spans):
                        flush_heading()
                    pending_heading.append(text)
                else:
                    flush_heading()
                    body.append(text)
            flush_heading()
            flush_body()

    return headings, blocks


def parse_prospectus(pdf_bytes: bytes) -> ProspectusParse:
    """Parse raw PDF bytes via Docling (legacy path; see parse_prospectus_fast for default).

    Docling provides excellent table-structure recovery via TableFormer ML,
    but is slow (~10–12 min CPU) due to full-document layout analysis.

    Requires the ``parse-ml`` extra (``uv sync --extra parse-ml``); the first call
    also downloads Docling's layout models (one-time, cached locally).
    """
    from io import BytesIO

    from docling.document_converter import DocumentConverter
    from docling_core.types.io import DocumentStream

    pdf_sha256 = sha256(pdf_bytes).hexdigest()
    converter = DocumentConverter()
    result = converter.convert(
        DocumentStream(name="prospectus.pdf", stream=BytesIO(pdf_bytes))
    )
    return document_to_parse(result.document, pdf_sha256)


def document_to_parse(document, pdf_sha256: str) -> ProspectusParse:
    """Normalize a Docling ``DoclingDocument`` into a persistable parse.

    Kept separate from :func:`parse_prospectus` (and free of a docling import)
    so the normalization is exercisable against any ``DoclingDocument``-shaped
    input without the torch stack.
    """
    from docling_core.types.doc import SectionHeaderItem, TableItem, TextItem

    headings: list[Heading] = []
    blocks: list[Block] = []

    for item, _level in document.iterate_items():
        if isinstance(item, SectionHeaderItem):
            text = (item.text or "").strip()
            if not text:
                continue
            headings.append(
                Heading(text=text, level=item.level, index=len(headings))
            )
        elif isinstance(item, TableItem):
            markdown = item.export_to_markdown().strip()
            if markdown:
                current = headings[-1].index if headings else -1
                blocks.append(
                    Block(
                        kind="table",
                        text=markdown,
                        headingIndex=current,
                        pageNumber=None,
                    )
                )
        elif isinstance(item, TextItem):
            text = (item.text or "").strip()
            if not text:
                continue
            current = headings[-1].index if headings else -1
            blocks.append(
                Block(
                    kind="text",
                    text=text,
                    headingIndex=current,
                    pageNumber=None,
                )
            )

    return ProspectusParse(
        pdfSha256=pdf_sha256, headings=headings, blocks=blocks
    )
