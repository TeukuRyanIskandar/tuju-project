"""Unit tests for the prospectus section router (spec 06, ticket 04).

Pure, infra-free tests of the heading-based router over the regulated
Bursa/SC prospectus section skeleton: the section-located case (all four
regulated sections sliced out of a Bursa-style table of contents), the
fallback case (a section the router cannot locate falls back to the whole
document, research ticket 08's baseline), slice boundaries (a section runs
until the next same-or-higher level heading), and heading normalization.
"""

from __future__ import annotations

import pytest

from tuju_ai.prospectus.models import (
    Block,
    Heading,
    ProspectusParse,
    ProspectusSection,
)

pytestmark = pytest.mark.unit


def _sha() -> str:
    return "0" * 64


def _parse(items: list[tuple[str, ...]]) -> ProspectusParse:
    """Build a parse from ("h", text, level) / ("text", text) / ("table", md)."""
    headings: list[Heading] = []
    blocks: list[Block] = []
    current = -1
    for item in items:
        if item[0] == "h":
            headings.append(
                Heading(text=item[1], level=int(item[2]), index=len(headings))
            )
            current = headings[-1].index
        else:
            blocks.append(
                Block(kind=item[0], text=item[1], headingIndex=current)
            )
    return ProspectusParse(pdfSha256=_sha(), headings=headings, blocks=blocks)


# A Bursa/SC-style Part-1 skeleton: numbered top-level chapters, numbered
# subsections, plus the regulated slices the router must find.
BURSA_STYLE_DOC: list[tuple[str, ...]] = [
    ("h", "1. Introduction", 1),
    ("text", "About this prospectus."),
    ("h", "2. Risk Factors", 1),
    ("text", "Risk one: customer concentration."),
    ("text", "Risk two: foreign exchange exposure."),
    ("h", "3. Industry Overview", 1),
    ("text", "The industry is competitive."),
    ("h", "4. Business Overview", 1),
    ("text", "The company sells widgets."),
    ("h", "4.1 Our Products", 2),
    ("text", "Widget details live here."),
    ("h", "5. Financial Overview", 1),
    ("text", "Revenue grew year on year."),
    ("h", "6. The Offering", 1),
    ("text", "Offer price RM1.00 per share."),
    ("h", "7. Utilisation of Proceeds", 1),
    ("text", "Proceeds fund working capital."),
    ("h", "8. Expected Timetable", 1),
    ("text", "Balloting is on Friday."),
]


def test_locates_all_four_regulated_sections() -> None:
    from tuju_ai.prospectus.router import route_sections

    routed = route_sections(_parse(BURSA_STYLE_DOC))

    assert set(routed) == set(ProspectusSection)

    offer = routed[ProspectusSection.OFFER]
    assert offer.located is True
    assert offer.matchedHeadings == ["the offering", "utilisation of proceeds"]
    assert "RM1.00" in offer.content
    assert "working capital" in offer.content
    # Only the offer slices — no risk/industry content bled in.
    assert "Risk one" not in offer.content
    assert "competitive" not in offer.content

    business = routed[ProspectusSection.BUSINESS]
    assert business.located is True
    assert business.matchedHeadings == ["business overview"]
    assert "sells widgets" in business.content
    # Subsection content belongs to the parent slice...
    assert "Widget details" in business.content
    # ...but the next same-level chapter ends it.
    assert "Revenue grew" not in business.content

    financials = routed[ProspectusSection.FINANCIALS]
    assert financials.located is True
    assert financials.matchedHeadings == ["financial overview"]
    assert financials.content == "Revenue grew year on year."

    risk = routed[ProspectusSection.RISK_FACTORS]
    assert risk.located is True
    assert risk.matchedHeadings == ["risk factors"]
    assert "Risk one" in risk.content and "Risk two" in risk.content
    assert "competitive" not in risk.content


def test_unlocatable_section_falls_back_to_whole_document() -> None:
    from tuju_ai.prospectus.router import route_sections

    # No financials-shaped heading anywhere.
    doc = [item for item in BURSA_STYLE_DOC if "Financial" not in item[1]]
    routed = route_sections(_parse(doc))

    financials = routed[ProspectusSection.FINANCIALS]
    assert financials.located is False
    assert financials.matchedHeadings == []
    # The fallback carries the whole document content (research 08 baseline).
    assert "sells widgets" in financials.content
    assert "Balloting" in financials.content
    # Other sections still located normally.
    assert routed[ProspectusSection.RISK_FACTORS].located is True


def test_heading_numbering_and_case_are_normalized() -> None:
    from tuju_ai.prospectus.router import route_sections

    routed = route_sections(
        _parse(
            [
                ("h", "SECTION 2 - RISK FACTORS", 1),
                ("text", "Numbered risk text."),
                ("h", "(3) Financial Overview", 1),
                ("text", "Numbered financials text."),
            ]
        )
    )

    assert routed[ProspectusSection.RISK_FACTORS].located is True
    assert "Numbered risk text." in routed[ProspectusSection.RISK_FACTORS].content
    assert routed[ProspectusSection.FINANCIALS].located is True
    assert "financials text" in routed[ProspectusSection.FINANCIALS].content


def test_nested_matching_headings_do_not_duplicate_content() -> None:
    from tuju_ai.prospectus.router import route_sections

    # "Use of Proceeds" is BOTH its own matching heading and a subsection
    # inside "The Offering" — the router must not include the block twice.
    routed = route_sections(
        _parse(
            [
                ("h", "The Offering", 1),
                ("text", "Offer price RM1.00."),
                ("h", "Use of Proceeds", 2),
                ("text", "Proceeds text."),
                ("h", "Timetable", 1),
                ("text", "Balloting Friday."),
            ]
        )
    )

    offer = routed[ProspectusSection.OFFER]
    assert offer.located is True
    assert offer.content.count("Proceeds text.") == 1
    assert "RM1.00" in offer.content


def test_tables_are_carried_into_section_content() -> None:
    from tuju_ai.prospectus.router import route_sections

    routed = route_sections(
        _parse(
            [
                ("h", "Financial Overview", 1),
                ("text", "Trend below."),
                ("table", "|Year|Revenue|\n|---|---|\n|2024|100|"),
                ("h", "Timetable", 1),
                ("text", "Balloting Friday."),
            ]
        )
    )

    assert "|2024|100|" in routed[ProspectusSection.FINANCIALS].content
    assert routed[ProspectusSection.FINANCIALS].located is True
