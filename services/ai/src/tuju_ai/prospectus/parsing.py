"""Docling parse adapter (spec 06, ticket 04; research ticket 08).

Parses a prospectus PDF ONCE with Docling (pure-Python, MIT, local — no API,
no LLM) into the normalized, persistable :class:`ProspectusParse`: headings
with levels, body text in reading order, and tables as markdown (Docling's
table-structure recovery is research ticket 08's reason for choosing it over
plain text extraction).

Docling (and its torch stack) is a *lazy* import inside :func:`parse_prospectus`
so the fast unit/PR lane and the JobBus worker boot never pay for it — it
ships in the optional ``parse`` extra.
"""

from __future__ import annotations

from hashlib import sha256

from .models import Block, Heading, ProspectusParse


def parse_prospectus(pdf_bytes: bytes) -> ProspectusParse:
    """Parse raw PDF bytes into a normalized :class:`ProspectusParse`.

    Parsed ONCE per PDF (minutes of one-time CPU), the parse is what
    :func:`~tuju_ai.prospectus.store.ensure_parse` claim-checks to S3 and
    re-runs reuse — this function itself has no persistence and no LLM.

    Requires the ``parse`` extra (``uv sync --extra parse``); the first call
    also downloads Docling's layout models (one-time, cached locally).
    """
    from io import BytesIO

    from docling.document_converter import DocumentConverter
    from docling_core.types.io import DocumentStream

    converter = DocumentConverter()
    result = converter.convert(
        DocumentStream(name="prospectus.pdf", stream=BytesIO(pdf_bytes))
    )
    return document_to_parse(result.document, sha256(pdf_bytes).hexdigest())


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
                    Block(kind="table", text=markdown, headingIndex=current)
                )
        elif isinstance(item, TextItem):
            text = (item.text or "").strip()
            if not text:
                continue
            current = headings[-1].index if headings else -1
            blocks.append(
                Block(kind="text", text=text, headingIndex=current)
            )
        # Pictures, groups, and furniture are deliberately dropped: the
        # section router and the ticket-05 prompts consume text + tables.

    return ProspectusParse(
        pdfSha256=pdf_sha256, headings=headings, blocks=blocks
    )
