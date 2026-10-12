"""Unit tests for the PyMuPDF prospectus parse (prospectus-v2 T01).

Synthetic PDFs built in-memory with pymupdf itself: a native-TOC document
(headings + levels straight from the TOC, blocks attributed to the most
recent heading at-or-before their page) and no-TOC documents laid out like a
real Bursa prospectus (typographic fallback: bold rows are headings, the
numbering span is kept, running headers and page furniture handled).
"""

from __future__ import annotations

import hashlib

import pytest

from tuju_ai.prospectus.models import (
    Block,
    Heading,
    ProspectusParse,
    ProspectusSection,
)

pytestmark = pytest.mark.unit

# --- synthetic PDF builders ----------------------------------------------------


def _pdf_with_toc() -> bytes:
    """3-page PDF: TOC with a nested level-2 entry, one section per page."""
    import pymupdf

    doc = pymupdf.open()
    for i in range(3):
        doc.new_page(width=400, height=300)
    pages_text = [
        "1. Risk Factors",  # page 0
        "2. Financial Overview",  # page 1
        "2.1 Historical Financial Information",  # page 2
    ]
    for i, text in enumerate(pages_text):
        doc[i].insert_text((72, 72), text)
        doc[i].insert_text((72, 110), f"Body text on page {i}.")
    doc.set_toc(
        [
            [1, "1. Risk Factors", 1],
            [1, "2. Financial Overview", 2],
            [2, "2.1 Historical Financial Information", 3],
        ]
    )
    return doc.tobytes()


def _pdf_no_toc() -> bytes:
    """2-page PDF without a TOC, laid out like a real Bursa prospectus: bold
    headings in the body font size with the section number as a separate
    span on the same baseline, regular-weight body (including a numbered
    body sentence), a page number, and a page-break running header whose
    title is NOT bold."""
    import pymupdf

    doc = pymupdf.open()
    doc.new_page(width=400, height=300)
    doc.new_page(width=400, height=300)
    doc[0].insert_text((40, 72), "1.", fontname="hebo")
    doc[0].insert_text((80, 72), "RISK FACTORS", fontname="hebo")
    doc[0].insert_text((80, 110), "Real risk one: customer concentration.")
    doc[0].insert_text((200, 280), "7")
    doc[1].insert_text((40, 40), "1.", fontname="hebo")
    doc[1].insert_text((80, 40), "RISK FACTORS (Cont'd)")
    doc[1].insert_text((80, 72), "More risk text on the next page.")
    doc[1].insert_text((40, 110), "2.", fontname="hebo")
    doc[1].insert_text((80, 110), "FINANCIAL OVERVIEW", fontname="hebo")
    doc[1].insert_text((80, 150), "2.5 million units were sold in FY2024.")
    return doc.tobytes()


# --- parse_prospectus_fast -------------------------------------------------------


def test_parse_prospectus_fast_with_toc() -> None:
    from tuju_ai.prospectus.parsing import parse_prospectus_fast

    pdf_bytes = _pdf_with_toc()
    parse = parse_prospectus_fast(pdf_bytes)

    assert parse.headingsFromToc is True
    assert [h.text for h in parse.headings] == [
        "1. Risk Factors",
        "2. Financial Overview",
        "2.1 Historical Financial Information",
    ]
    # Native TOC levels survive (non-flat), not the numbering heuristic.
    assert [h.level for h in parse.headings] == [1, 1, 2]
    assert parse.pdfSha256 == hashlib.sha256(pdf_bytes).hexdigest()


def test_parse_prospectus_fast_toc_page_attribution() -> None:
    """A block belongs to the most recent heading AT-OR-BEFORE its page —
    not to the document's last heading (off-by-one regression guard)."""
    from tuju_ai.prospectus.parsing import parse_prospectus_fast

    parse = parse_prospectus_fast(_pdf_with_toc())

    by_page: dict[int, set[int]] = {}
    for block in parse.blocks:
        by_page.setdefault(block.pageNumber, set()).add(block.headingIndex)

    assert by_page[0] == {0}  # page 0 → heading 0 (1. Risk Factors)
    assert by_page[1] == {1}  # page 1 → heading 1 (2. Financial Overview)
    assert by_page[2] == {2}  # page 2 → heading 2 (2.1 Historical ...)


def test_parse_prospectus_fast_toc_attribution_carries_past_heading_pages() -> None:
    """Pages after the last heading start keep the last heading's index."""
    from tuju_ai.prospectus.parsing import parse_prospectus_fast

    import pymupdf

    doc = pymupdf.open()
    for _ in range(5):
        doc.new_page(width=400, height=300)
    doc[0].insert_text((72, 72), "1. Risk Factors")
    for i in range(5):
        doc[i].insert_text((72, 110), f"Body text on page {i}.")
    doc.set_toc([[1, "1. Risk Factors", 1]])
    parse = parse_prospectus_fast(doc.tobytes())

    for block in parse.blocks:
        assert block.headingIndex == 0


def test_parse_prospectus_fast_fallback_no_toc() -> None:
    from tuju_ai.prospectus.parsing import parse_prospectus_fast

    parse = parse_prospectus_fast(_pdf_no_toc())

    assert parse.headingsFromToc is False
    # Bold rows are headings on EVERY page; the numbering span is KEPT (the
    # router's effective_levels() reads depth from it), and the running
    # header survives as a heading (the router treats it as transparent).
    assert [h.text for h in parse.headings] == [
        "1. RISK FACTORS",
        "1. RISK FACTORS (Cont'd)",
        "2. FINANCIAL OVERVIEW",
    ]
    assert all(h.level == 1 for h in parse.headings)
    # Regular-weight "2.5 million units were sold..." is body, not a heading.
    assert any("million" in b.text for b in parse.blocks)


def test_parse_prospectus_fast_fallback_attribution() -> None:
    from tuju_ai.prospectus.parsing import parse_prospectus_fast

    parse = parse_prospectus_fast(_pdf_no_toc())

    by_text = {b.text: b for b in parse.blocks}
    assert by_text["Real risk one: customer concentration."].headingIndex == 0
    assert by_text["More risk text on the next page."].headingIndex == 1
    assert by_text["2.5 million units were sold in FY2024."].headingIndex == 2
    # Page numbers are furniture, not content.
    assert "7" not in by_text


def test_parse_prospectus_fast_fallback_routes_through_running_header() -> None:
    """End-to-end on the no-TOC path: the running header does not cut the
    risk-factors chapter short, and the next chapter closes it."""
    from tuju_ai.prospectus.parsing import parse_prospectus_fast
    from tuju_ai.prospectus.router import route_sections

    routed = route_sections(parse_prospectus_fast(_pdf_no_toc()))

    risks = routed[ProspectusSection.RISK_FACTORS]
    assert risks.located
    assert "customer concentration" in risks.content
    assert "More risk text" in risks.content
    assert "million units" not in risks.content
    assert routed[ProspectusSection.FINANCIALS].located


def test_parse_prospectus_fast_fallback_wrapped_headings() -> None:
    """A bold heading wrapped over two rows is one heading; a wrapped running
    header whose ``(Cont'd)`` tail is not bold is one heading too."""
    import pymupdf

    from tuju_ai.prospectus.parsing import parse_prospectus_fast

    doc = pymupdf.open()
    page = doc.new_page(width=400, height=400)
    page.insert_text((40, 40), "4.", fontname="hebo")
    page.insert_text((80, 40), "INFORMATION ON OUR PROMOTERS, DIRECTORS", fontname="hebo")
    page.insert_text((80, 52), "AND KEY SENIOR MANAGEMENT", fontname="hebo")
    page.insert_text((80, 90), "Body under chapter four.")
    page.insert_text((40, 130), "4.1", fontname="hebo")
    page.insert_text((80, 130), "PROMOTERS AND SUBSTANTIAL", fontname="hebo")
    page.insert_text((80, 142), "SHAREHOLDERS", fontname="hebo")
    page.insert_text((80, 180), "Body under 4.1.")
    page = doc.new_page(width=400, height=400)
    page.insert_text((40, 40), "4.", fontname="hebo")
    page.insert_text((80, 40), "INFORMATION ON OUR PROMOTERS, DIRECTORS", fontname="hebo")
    page.insert_text((80, 52), "AND KEY SENIOR MANAGEMENT", fontname="hebo")
    page.insert_text((280, 52), "(Cont'd)")
    page.insert_text((80, 90), "Still chapter four.")

    parse = parse_prospectus_fast(doc.tobytes())

    assert [h.text for h in parse.headings] == [
        "4. INFORMATION ON OUR PROMOTERS, DIRECTORS AND KEY SENIOR MANAGEMENT",
        "4.1 PROMOTERS AND SUBSTANTIAL SHAREHOLDERS",
        "4. INFORMATION ON OUR PROMOTERS, DIRECTORS AND KEY SENIOR MANAGEMENT (Cont'd)",
    ]


def test_block_page_numbers() -> None:
    from tuju_ai.prospectus.parsing import parse_prospectus_fast

    parse = parse_prospectus_fast(_pdf_with_toc())

    assert parse.blocks, "expected text blocks"
    assert all(b.pageNumber is not None for b in parse.blocks)
    assert all(0 <= b.pageNumber < 3 for b in parse.blocks)
    # Each block's text was inserted on its own page, so the pages agree.
    assert {b.pageNumber for b in parse.blocks} == {0, 1, 2}


def test_parse_prospectus_fast_blank_pdf() -> None:
    import pymupdf

    from tuju_ai.prospectus.parsing import parse_prospectus_fast

    doc = pymupdf.open()  # one blank page: no TOC, no text
    doc.new_page(width=400, height=300)
    parse = parse_prospectus_fast(doc.tobytes())

    assert parse.headings == []
    assert parse.blocks == []
    assert parse.headingsFromToc is False


# --- Router: native TOC levels vs heuristic fallback -----------------------------


def _parse(
    headings: list[tuple[str, int]],
    blocks: list[tuple[str, int, int]],
    headings_from_toc: bool,
) -> ProspectusParse:
    """Build a parse: headings as (text, level), blocks as (text, headingIdx, page)."""
    return ProspectusParse(
        pdfSha256="0" * 64,
        headingsFromToc=headings_from_toc,
        headings=[
            Heading(text=text, level=level, index=i)
            for i, (text, level) in enumerate(headings)
        ],
        blocks=[
            Block(kind="text", text=text, headingIndex=idx, pageNumber=page)
            for text, idx, page in blocks
        ],
    )


def test_router_uses_native_toc_levels_when_present() -> None:
    from tuju_ai.prospectus.router import route_sections

    # Numbering says "2.9" (heuristic depth 2) but the TOC says level 1:
    # with headingsFromToc=True the native level governs the slice end.
    parse = _parse(
        headings=[
            ("2.9 Financial Highlights", 1),  # native level 1
            ("2.9.1 Revenue", 2),
            ("3. The Offering", 1),
        ],
        blocks=[
            ("highlights body", 0, 0),
            ("revenue body", 1, 0),
            ("offering body", 2, 1),
        ],
        headings_from_toc=True,
    )

    routed = route_sections(parse)
    fin = routed[ProspectusSection.FINANCIALS]
    assert fin.located is True
    assert "highlights body" in fin.content
    assert "revenue body" in fin.content
    assert "offering body" not in fin.content


def test_router_falls_back_to_effective_levels_without_toc() -> None:
    from tuju_ai.prospectus.router import heading_levels

    # Same numbering, no TOC flag: the heuristic recovers depth 2 for "2.9".
    parse = _parse(
        headings=[("2.9 Financial Highlights", 1), ("2.9.1 Revenue", 2)],
        blocks=[],
        headings_from_toc=False,
    )

    assert heading_levels(parse) == [2, 3]


# --- multi-part prospectuses ---------------------------------------------------


def test_merge_pdf_parts_keeps_pages_in_order_and_routes_across_parts() -> None:
    """Part 1 + Part 2 merge into one valid PDF; a chapter that only exists in
    Part 2 is located after the merge."""
    import pymupdf

    from tuju_ai.prospectus.parsing import merge_pdf_parts, parse_prospectus_fast
    from tuju_ai.prospectus.router import route_sections

    def part(heading_num: str, title: str, body: str) -> bytes:
        doc = pymupdf.open()
        page = doc.new_page(width=400, height=300)
        page.insert_text((40, 72), heading_num, fontname="hebo")
        page.insert_text((80, 72), title, fontname="hebo")
        page.insert_text((80, 110), body)
        return doc.tobytes()

    part1 = part("2.", "RISK FACTORS", "Risk body in part one.")
    part2 = part("7.", "BUSINESS OVERVIEW", "Business body in part two.")

    merged = merge_pdf_parts([part1, part2])
    assert pymupdf.open(stream=merged, filetype="pdf").page_count == 2

    parse = parse_prospectus_fast(merged)
    assert [b.pageNumber for b in parse.blocks if "body" in b.text] == [0, 1]
    routed = route_sections(parse)
    assert routed[ProspectusSection.BUSINESS].located
    assert "part two" in routed[ProspectusSection.BUSINESS].content

    # Deterministic: the same parts merge to the same bytes (the pdfSha256
    # idempotency key), so a re-run reuses the persisted parse.
    assert merge_pdf_parts([part1, part2]) == merged


def test_merge_pdf_parts_single_part_is_identity() -> None:
    from tuju_ai.prospectus.parsing import merge_pdf_parts

    pdf = _pdf_no_toc()
    assert merge_pdf_parts([pdf]) == pdf
    with pytest.raises(ValueError):
        merge_pdf_parts([])


def test_group_pdf_parts_orders_parts_and_keeps_single_files() -> None:
    from pathlib import Path

    from tuju_ai.prospectus.parsing import group_pdf_parts

    pdfs = [
        Path("lsh_2025_part3of3.pdf"),
        Path("lsh_2025_part1of3.pdf"),
        Path("fbbhd_2025_part2.pdf"),
        Path("lsh_2025_part2of3.pdf"),
        Path("fbbhd_2025_part1.pdf"),
        Path("solo.pdf"),
    ]
    groups = group_pdf_parts(pdfs)
    assert {k: [p.name for p in v] for k, v in groups.items()} == {
        "lsh_2025": ["lsh_2025_part1of3.pdf", "lsh_2025_part2of3.pdf", "lsh_2025_part3of3.pdf"],
        "fbbhd_2025": ["fbbhd_2025_part1.pdf", "fbbhd_2025_part2.pdf"],
        "solo": ["solo.pdf"],
    }
