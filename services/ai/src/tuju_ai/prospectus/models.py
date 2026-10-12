"""Internal prospectus-pipeline models (spec 06, tickets 04/05).

These Pydantic models are the AI module's OWN intermediate representation —
opaque to the wire contract (ADR-0004/0007: the S3 artifact's internal shape
is owned by this module and evolves freely without touching
``packages/contracts``).

Two layers:

* :class:`ProspectusParse` — the persisted PDF parse (headings + ordered
  content blocks; PyMuPDF by default, Docling as the legacy extra), claim-checked to S3 and reused across re-runs (ticket 04).
* :class:`RoutedSection` — one regulated output section sliced out of the
  parse by the router (ticket 04), the input the ticket-05 LLM prompts read.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field

from ..contracts_generated import SCHEMA_VERSIONS


class ProspectusSection(StrEnum):
    """The regulated output sections routed out of a prospectus."""

    OFFER = "offer"
    BUSINESS = "business"
    FINANCIALS = "financials"
    RISK_FACTORS = "risk-factors"
    LOCKUP = "lockup"
    RELATED_PARTY = "related-party"


class Heading(BaseModel):
    """One document heading, in reading order."""

    text: str
    """1 = top level; higher numbers are deeper subsections."""

    level: int
    """Position in the parse's heading list (== :attr:`index` of the entry)."""

    index: int


class Block(BaseModel):
    """One content block under the most recent heading.

    ``kind`` is ``"text"`` (body text), ``"table"`` (markdown-rendered table
    — Docling's table-structure recovery, research ticket 08's reason for
    choosing Docling over plain text extraction), or ``"heading"`` (a heading's
    own text echoed into the content stream by the PyMuPDF typographic parse,
    so sub-headings and bold table column headers reach the prompts; it does
    not by itself make a section "located").

    ``pageNumber`` is the 0-indexed page this block appears on (PyMuPDF parse;
    ``None`` for Docling parses). Used for debugging and multi-part stitching.
    """

    kind: str
    text: str
    headingIndex: int = -1
    pageNumber: int | None = None


class ProspectusParse(BaseModel):
    """The normalized, persistable parse of one prospectus PDF.

    Keyed by ``pdfSha256`` so a re-run against a CHANGED PDF re-parses even
    under the same prospectus id (idempotent re-run, ticket 04 AC 2).

    ``headingsFromToc`` marks headings extracted from the PDF's native table
    of contents (PyMuPDF parse): those levels are trusted as-is by the
    router. ``False`` (Docling parses, or the no-TOC heuristic fallback)
    means the stored levels are flat/unreliable and the router recovers the
    hierarchy via ``effective_levels()``.
    """

    schemaVersion: str = SCHEMA_VERSIONS['prospectusparse']
    pdfSha256: str
    headingsFromToc: bool = False
    headings: list[Heading] = Field(default_factory=list)
    blocks: list[Block] = Field(default_factory=list)


class RoutedSection(BaseModel):
    """One regulated section's routed content.

    ``located=False`` means the router could not confidently locate the
    section and ``content`` carries the whole document instead — research
    ticket 08's baseline/fallback path, made explicit rather than silent.
    """

    section: str
    located: bool
    matchedHeadings: list[str] = Field(default_factory=list)
    content: str
    contentChars: int = 0
