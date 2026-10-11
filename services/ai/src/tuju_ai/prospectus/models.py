"""Internal prospectus-pipeline models (spec 06, tickets 04/05).

These Pydantic models are the AI module's OWN intermediate representation —
opaque to the wire contract (ADR-0004/0007: the S3 artifact's internal shape
is owned by this module and evolves freely without touching
``packages/contracts``).

Two layers:

* :class:`ProspectusParse` — the persisted Docling parse (headings + ordered
  content blocks), claim-checked to S3 and reused across re-runs (ticket 04).
* :class:`RoutedSection` — one regulated output section sliced out of the
  parse by the router (ticket 04), the input the ticket-05 LLM prompts read.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field

from ..contracts_generated import SCHEMA_VERSIONS


class ProspectusSection(StrEnum):
    """The four regulated output sections routed out of a prospectus."""

    OFFER = "offer"
    BUSINESS = "business"
    FINANCIALS = "financials"
    RISK_FACTORS = "risk-factors"


class Heading(BaseModel):
    """One document heading, in reading order."""

    text: str
    """1 = top level; higher numbers are deeper subsections."""

    level: int
    """Position in the parse's heading list (== :attr:`index` of the entry)."""

    index: int


class Block(BaseModel):
    """One content block under the most recent heading.

    ``kind`` is ``"text"`` (body text) or ``"table"`` (markdown-rendered table
    — Docling's table-structure recovery, research ticket 08's reason for
    choosing Docling over plain text extraction).
    """

    kind: str
    text: str
    headingIndex: int = -1


class ProspectusParse(BaseModel):
     """The normalized, persistable Docling parse of one prospectus PDF.

     Keyed by ``pdfSha256`` so a re-run against a CHANGED PDF re-parses even
     under the same prospectus id (idempotent re-run, ticket 04 AC 2).
     """

     schemaVersion: str = SCHEMA_VERSIONS['prospectusparse']
     pdfSha256: str
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
