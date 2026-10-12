"""Idempotent parse persistence for the prospectus pipeline (spec 06, ticket 04).

The parse is the expensive step (seconds with the PyMuPDF default, minutes
with the legacy Docling extra), so it is persisted ONCE as an S3 claim-check artifact
(ADR-0004) keyed by prospectus, and reused across re-runs: a re-run against
the same PDF does not re-parse (ticket 04 AC 2). The artifact carries the
PDF's sha256 so a re-seeded, CHANGED PDF under the same prospectus id
re-parses rather than silently serving a stale parse.
"""

from __future__ import annotations

from hashlib import sha256
from typing import Callable

from ..artifacts import ArtifactStore
from .models import ProspectusParse

# Parse functions: raw PDF bytes → normalized parse (parse_prospectus_fast in
# parsing.py is the default; tests inject a counted fake).
ParseFn = Callable[[bytes], ProspectusParse]


def parse_artifact_key(prospectus_id: str) -> str:
    """S3 key suffix (under the scoped prefix) for a prospectus's parse."""
    return f"prospectus/{prospectus_id}/parse.json"


def ensure_parse(
    *,
    artifact_store: ArtifactStore,
    prospectus_id: str,
    pdf_bytes: bytes,
    parse_fn: ParseFn,
) -> tuple[ProspectusParse, bool]:
    """Return ``(parse, parsed_now)`` for this prospectus's PDF.

    Reuses the persisted parse when one exists AND its ``pdfSha256`` matches
    the given bytes (``parsed_now=False``, near-free); otherwise runs
    ``parse_fn`` and claim-checks the fresh parse to S3 (``parsed_now=True``).
    """
    pdf_sha = sha256(pdf_bytes).hexdigest()

    existing = artifact_store.get_artifact(parse_artifact_key(prospectus_id))
    if existing is not None and existing.get("pdfSha256") == pdf_sha:
        return ProspectusParse.model_validate(existing), False

    parse = parse_fn(pdf_bytes)
    if parse.pdfSha256 != pdf_sha:  # the adapter must key the parse to the PDF
        parse = parse.model_copy(update={"pdfSha256": pdf_sha})

    artifact_store.put_artifact(
        parse_artifact_key(prospectus_id), parse.model_dump(mode="json")
    )
    return parse, True
