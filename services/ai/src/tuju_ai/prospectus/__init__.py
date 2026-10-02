"""Prospectus pipeline (spec 06): parse → route → persist, LLM-free (ticket 04).

The ingestion half of the flagship IPO-prospectus artifact:

* :mod:`.parsing` — Docling parse → normalized :class:`ProspectusParse`
  (lazy docling import; lives in the optional ``parse`` extra).
* :mod:`.skeleton` — the regulated Bursa/SC section skeleton.
* :mod:`.router` — heading-based routing of the four regulated sections,
  with the explicit whole-document fallback (research ticket 08).
* :mod:`.store` — idempotent S3 claim-check of the parse, keyed by
  prospectus (ADR-0004), reused across re-runs.
* :mod:`.cli` — the verifiable standalone entrypoint.

The LLM analysis, the ``analyze-prospectus`` job, and the read endpoint are
ticket 05.
"""

from .models import (
    Block,
    Heading,
    ProspectusParse,
    ProspectusSection,
    RoutedSection,
)
from .router import route_sections
from .skeleton import matches_skeleton, normalize_heading
from .store import ensure_parse, parse_artifact_key

__all__ = [
    "Block",
    "Heading",
    "ProspectusParse",
    "ProspectusSection",
    "RoutedSection",
    "ensure_parse",
    "matches_skeleton",
    "normalize_heading",
    "parse_artifact_key",
    "route_sections",
]
