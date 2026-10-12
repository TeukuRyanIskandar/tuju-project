"""One-off corpus inspection (not part of the test suite).

Parses each real demo-corpus prospectus (PyMuPDF, the default parse), prints the heading
skeleton + routing table, and dumps a compact headings.json next to the PDFs
so the section-skeleton patterns can be tuned against reality.

Usage: uv run --project services/ai python scripts/inspect_corpus.py
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CORPUS = REPO / ".scratch" / "free-tier" / "demo-corpus" / "prospectuses"

from tuju_ai.prospectus.models import ProspectusSection
from tuju_ai.prospectus.parsing import parse_prospectus_fast
from tuju_ai.prospectus.router import route_sections


def main() -> int:
    pdfs = sorted(CORPUS.glob("*.pdf"))
    if not pdfs:
        print(f"no PDFs found under {CORPUS}", file=sys.stderr)
        return 1

    out: dict[str, dict] = {}
    for pdf in pdfs:
        t0 = time.time()
        print(f"--- parsing {pdf.name} ...", flush=True)
        parse = parse_prospectus_fast(pdf.read_bytes())
        routed = route_sections(parse)
        elapsed = time.time() - t0
        print(
            f"    headings={len(parse.headings)} blocks={len(parse.blocks)}"
            f" elapsed={elapsed:.0f}s",
            flush=True,
        )
        for section in ProspectusSection:
            r = routed[section]
            print(
                f"    {section.value:12} located={r.located}"
                f" chars={r.contentChars} matched={r.matchedHeadings}",
                flush=True,
            )
        out[pdf.name] = {
            "pdfSha256": parse.pdfSha256,
            "headings": [
                {"text": h.text, "level": h.level, "index": h.index}
                for h in parse.headings
            ],
            "blocks": len(parse.blocks),
            "routing": {
                s.value: {
                    "located": routed[s].located,
                    "matchedHeadings": routed[s].matchedHeadings,
                    "contentChars": routed[s].contentChars,
                }
                for s in ProspectusSection
            },
        }
    dest = CORPUS / "headings.json"
    dest.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"wrote {dest}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
