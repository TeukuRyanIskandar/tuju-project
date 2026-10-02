"""Heading-based section router (spec 06, ticket 04; research ticket 08).

Routes the four regulated output sections (:class:`ProspectusSection`) out of
a persisted :class:`~tuju_ai.prospectus.models.ProspectusParse` by matching
headings against the regulated Bursa/SC section skeleton. A matched heading
opens a slice that runs until the NEXT same-or-higher level heading — so the
chapter's subsections come along, but sibling chapters do not.

A section the router cannot confidently locate falls back EXPLICITLY to the
whole-document content (``located=False``) — research ticket 08's baseline
path, never a silent empty section.

Pure and infra-free: parsing (Docling) is the expensive step and lives in
:mod:`tuju_ai.prospectus.parsing`; this module is the cheap, re-runnable half
ticket 05 re-runs per analysis.
"""

from __future__ import annotations

from .models import Block, ProspectusParse, ProspectusSection, RoutedSection
from .skeleton import matches_skeleton, normalize_heading


def _slice_end(headings: list, matched_index: int) -> int:
    """First heading index at/after ``matched_index`` that ends the slice.

    The slice runs until the next heading with level <= the matched heading's
    level (same-or-higher), or the end of the document.
    """
    matched_level = headings[matched_index].level
    for j in range(matched_index + 1, len(headings)):
        if headings[j].level <= matched_level:
            return j
    return len(headings)


def _blocks_for(blocks: list[Block], heading_indexes: set[int]) -> list[Block]:
    """Blocks sitting under any heading in ``heading_indexes`` (in order)."""
    return [b for b in blocks if b.headingIndex in heading_indexes]


def _whole_document(parse: ProspectusParse) -> str:
    blocks = [b for b in parse.blocks if b.text.strip()]
    return "\n\n".join(b.text for b in blocks)


def route_sections(
    parse: ProspectusParse,
) -> dict[ProspectusSection, RoutedSection]:
    """Route all four regulated sections out of ``parse``.

    Always returns one :class:`RoutedSection` per section — ``located=True``
    with the sliced content when at least one skeleton heading matched,
    ``located=False`` with the whole-document content otherwise.
    """
    routed: dict[ProspectusSection, RoutedSection] = {}

    for section in ProspectusSection:
        matched: list[int] = []
        matched_headings: list[str] = []
        for heading in parse.headings:
            if matches_skeleton(heading.text) is section:
                matched.append(heading.index)
                matched_headings.append(normalize_heading(heading.text))

        if matched:
            # Every heading inside a matched slice's span belongs to the
            # section (sub-headings too); block indexes dedupe nested matches.
            heading_indexes: set[int] = set()
            for i in matched:
                heading_indexes.update(range(i, _slice_end(parse.headings, i)))
            content_blocks = _blocks_for(parse.blocks, heading_indexes)
            content = "\n\n".join(b.text for b in content_blocks if b.text.strip())
            routed[section] = RoutedSection(
                section=section.value,
                located=True,
                matchedHeadings=matched_headings,
                content=content,
                contentChars=len(content),
            )
        else:
            whole = _whole_document(parse)
            routed[section] = RoutedSection(
                section=section.value,
                located=False,
                matchedHeadings=[],
                content=whole,
                contentChars=len(whole),
            )

    return routed
