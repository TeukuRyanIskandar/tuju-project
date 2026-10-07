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

import re

from .models import Block, ProspectusParse, ProspectusSection, RoutedSection
from .skeleton import matches_skeleton, normalize_heading

# "2. RISK", "2.9 FINANCIAL HIGHLIGHTS", "4.9.2 Offer for Sale": the dotted
# numbering depth is the real heading hierarchy.
_NUMBERING = re.compile(r"^\s*(\d+(?:\.\d+)*)\.?\s")


# Page-break continuation headings ("2. PROSPECTUS SUMMARY (Cont'd)"). One
# demo PDF's font encoding garbles the apostrophe form to "�&RQW¶G�".
_CONTINUATION = re.compile(r"(?:\(\s*cont['’]d\s*\)|&rqw¶g)\W*$", re.IGNORECASE)


def is_continuation(text: str) -> bool:
    """True for a repeated running-chapter heading at a page break."""
    return bool(_CONTINUATION.search(text.strip()))


def effective_levels(headings: list) -> list[int]:
    """Heading levels with the hierarchy recovered from section numbering.

    Docling reports EVERY heading of the real Bursa prospectuses at level 1
    (observed on all three demo-corpus PDFs), which would end every slice at
    the very next heading and leave matched chapters empty. The prospectus's
    own numbering is reliable instead: ``2.`` is depth 1, ``2.9`` depth 2,
    ``2.9.1`` depth 3. Unnumbered headings ("Notes:", "(b) Offer for Sale")
    are treated as children of the preceding numbered heading. Before any
    numbered heading is seen, Docling's own level is used unchanged.
    """
    levels: list[int] = []
    last_numbered_depth: int | None = None
    for heading in headings:
        match = _NUMBERING.match(heading.text)
        if match:
            last_numbered_depth = match.group(1).count(".") + 1
            levels.append(last_numbered_depth)
        elif last_numbered_depth is not None:
            levels.append(last_numbered_depth + heading.level)
        else:
            levels.append(heading.level)
    return levels


def _slice_end(headings: list, levels: list[int], matched_index: int) -> int:
    """First heading index after ``matched_index`` that ends the slice.

    The slice runs until the next heading with effective level <= the matched
    heading's level (same-or-higher), or the end of the document. Page-break
    continuation headings of an ENCLOSING chapter ("2. SUMMARY (Cont'd)" in
    the middle of 2.5 RISK FACTORS) are transparent: they repeat the running
    title, they do not end the subsection.
    """
    matched_level = levels[matched_index]
    for j in range(matched_index + 1, len(levels)):
        if levels[j] <= matched_level:
            if levels[j] < matched_level and is_continuation(headings[j].text):
                continue
            return j
    return len(levels)


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
    levels = effective_levels(parse.headings)

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
                heading_indexes.update(range(i, _slice_end(parse.headings, levels, i)))
            content_blocks = _blocks_for(parse.blocks, heading_indexes)
            content = "\n\n".join(b.text for b in content_blocks if b.text.strip())
        else:
            content = ""

        # A heading matched but its slice carries no content (e.g. a
        # heading-only page): that is NOT located — fall back explicitly
        # rather than hand ticket 05 an empty section.
        if matched and content:
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
