"""CLI: parse + route one prospectus PDF (spec 06, ticket 04).

``uv run --project services/ai tuju-ai-prospectus-parse --prospectus-id <id> --pdf <path>``

Reads the PDF, parses it ONCE with Docling (idempotent — a re-run reuses the
persisted parse artifact from S3 when the PDF sha matches), routes the four
regulated sections, claim-checks the parse, and prints a routing report.
This is the verifiable standalone path for ticket 04's acceptance criterion
1 (running the parser against each of the real corpus PDFs). No LLM anywhere
in this path.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from ..artifacts import ArtifactStore
from ..config import Settings
from .models import ProspectusSection
from .router import route_sections
from .store import ensure_parse, parse_artifact_key


def build_report(prospectus_id: str, parse, parsed_now: bool, routed, key: str):
    """Assemble the JSON routing report printed to stdout."""
    return {
        "prospectusId": prospectus_id,
        "parseArtifactKey": key,
        "parsedNow": parsed_now,
        "pdfSha256": parse.pdfSha256,
        "headings": len(parse.headings),
        "blocks": len(parse.blocks),
        "sections": {
            section.value: {
                "located": routed[section].located,
                "matchedHeadings": routed[section].matchedHeadings,
                "contentChars": routed[section].contentChars,
            }
            for section in ProspectusSection
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="tuju-ai-prospectus-parse",
        description=(
            "Parse a prospectus PDF with Docling, persist the parse as an S3 "
            "claim-check (idempotent), and route the four regulated sections."
        ),
    )
    parser.add_argument(
        "--prospectus-id",
        required=True,
        help="Prospectus id (the IpoListing row id) keying the parse artifact.",
    )
    parser.add_argument(
        "--pdf",
        required=True,
        type=Path,
        help="Path to the prospectus PDF (the demo corpus's stored copy).",
    )
    args = parser.parse_args(argv)

    from .parsing import parse_prospectus  # lazy: docling lives in the extra

    pdf_bytes = args.pdf.read_bytes()
    settings = Settings.from_env()
    store = ArtifactStore(settings)

    parse, parsed_now = ensure_parse(
        artifact_store=store,
        prospectus_id=args.prospectus_id,
        pdf_bytes=pdf_bytes,
        parse_fn=parse_prospectus,
    )
    routed = route_sections(parse)

    report = build_report(
        args.prospectus_id, parse, parsed_now, routed, parse_artifact_key(args.prospectus_id)
    )
    json.dump(report, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
