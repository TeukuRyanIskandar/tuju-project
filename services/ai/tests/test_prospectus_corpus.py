"""Corpus-lane test: the real demo-corpus prospectus PDFs (spec 06, ticket 04).

Ticket 04's acceptance criterion 1: running the parser against EACH of the 3
real 2025 Bursa IPO prospectus PDFs (the manually-curated corpus, tracked in
git at ``.scratch/free-tier/demo-corpus/prospectuses/``) locates — or
explicitly falls back for — the regulated sections.

This lane is marked ``corpus``: it parses the real PDFs with the default
PyMuPDF path (``parse_prospectus_fast`` via ``ensure_parse``, a few seconds
for all three) and is deselected from both the unit/PR lane and the
testcontainers integration lane; run it explicitly with
``uv run --project services/ai pytest -m corpus``. The routing reality per
document is pinned here, tuned against the corpus with
``scripts/inspect_corpus.py``.
"""

from __future__ import annotations

from hashlib import sha256
from pathlib import Path

import pytest

pytestmark = [pytest.mark.corpus]

from tuju_ai.artifacts import ArtifactStore
from tuju_ai.config import Settings
from tuju_ai.prospectus.models import ProspectusParse, ProspectusSection
from tuju_ai.prospectus.parsing import (
    group_pdf_parts,
    merge_pdf_parts,
    parse_prospectus_fast,
)
from tuju_ai.prospectus.router import route_sections
from tuju_ai.prospectus.store import ensure_parse

CORPUS_DIR = (
    Path(__file__).resolve().parents[3]
    / ".scratch"
    / "free-tier"
    / "demo-corpus"
    / "prospectuses"
)

# Multi-part prospectuses (``x_part1of3.pdf``, ``x_part2of3.pdf``, ...) are
# merged into one PDF before parsing, as the live run does.
PROSPECTUSES = group_pdf_parts(sorted(CORPUS_DIR.glob("*.pdf")))
NAMES = sorted(PROSPECTUSES)


def _pdf_bytes(name: str) -> bytes:
    return merge_pdf_parts([p.read_bytes() for p in PROSPECTUSES[name]])


class InMemoryS3:
    """Minimal put/get stand-in so the idempotency seam needs no LocalStack."""

    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}
        self.puts: list[dict] = []

    def put_object(self, *, Bucket: str, Key: str, Body: bytes, **_: object) -> dict:
        self.objects[(Bucket, Key)] = Body
        self.puts.append({"Bucket": Bucket, "Key": Key})
        return {"ETag": '"stub"'}

    def get_object(self, *, Bucket: str, Key: str) -> dict:
        from botocore.exceptions import ClientError

        body = self.objects.get((Bucket, Key))
        if body is None:
            raise ClientError(
                {"Error": {"Code": "NoSuchKey", "Message": "Not Found"}}, "GetObject"
            )
        return {"Body": body}


def _settings() -> Settings:
    return Settings(
        redis_url="redis://unused",
        s3_endpoint_url="http://localstack:4566",
        s3_region="ap-southeast-1",
        s3_bucket="tuju-artifacts",
        s3_prefix="analysis",
        backend_api_url="http://backend-unused",
    )


# Routing reality pinned per prospectus (tuned with scripts/inspect_corpus.py).
# With every part present and merged (.scratch/prospectus-v2/corpus-manifest.md),
# all six sections locate in all three prospectuses, including Fibromat's
# Business Overview and each Related Party Transactions chapter, which live
# past Part 1. A section listed here must fall back to whole-document content
# explicitly instead.
EXPECTED_FALLBACKS: dict[str, set[ProspectusSection]] = {
    "fbbhd_fibromat-m-berhad_2025-04-11": set(),
    "iab_insights-analytics-berhad_2025-10-07": set(),
    "lsh_lim-seong-ha-capital-berhad_2025": set(),
}


@pytest.fixture(scope="module")
def parsed() -> dict[str, ProspectusParse]:
    """Parse each real prospectus ONCE via ``ensure_parse`` for the module,
    claim-checked in memory."""
    store = ArtifactStore(_settings(), s3_client=InMemoryS3())
    return {
        name: ensure_parse(
            artifact_store=store,
            prospectus_id=name,
            pdf_bytes=_pdf_bytes(name),
            parse_fn=parse_prospectus_fast,
        )[0]
        for name in NAMES
    }


@pytest.mark.skipif(
    not NAMES, reason="corpus PDFs not present (.scratch/free-tier/demo-corpus)"
)
@pytest.mark.parametrize("name", NAMES)
def test_real_prospectus_routes_all_four_sections(
    parsed: dict[str, ProspectusParse], name: str
) -> None:
    parse = parsed[name]
    assert parse.headings, "the parse found no headings in a real prospectus"
    assert parse.blocks, "the parse found no content blocks in a real prospectus"
    # The parse is keyed to the exact PDF bytes (idempotency anchor).
    assert parse.pdfSha256 == sha256(_pdf_bytes(name)).hexdigest()

    routed = route_sections(parse)
    assert set(routed) == set(ProspectusSection)

    for section in ProspectusSection:
        result = routed[section]
        assert result.located is (section not in EXPECTED_FALLBACKS[name]), (
            f"{name}: {section.value} located={result.located}, "
            f"matched={result.matchedHeadings}"
        )
        # Located or EXPLICIT fallback — never a silent empty section; and
        # always enough content for the ticket-05 prompts to work with.
        assert isinstance(result.located, bool)
        assert result.contentChars > 0
        if result.located:
            assert result.matchedHeadings
        else:
            assert result.matchedHeadings == []


@pytest.mark.skipif(
    not NAMES, reason="corpus PDFs not present (.scratch/free-tier/demo-corpus)"
)
@pytest.mark.parametrize("name", NAMES)
def test_re_run_reuses_parse_no_reparse_for_real_pdfs(
    parsed: dict[str, ProspectusParse], name: str
) -> None:
    parse = parsed[name]
    store = ArtifactStore(_settings(), s3_client=InMemoryS3())
    calls = {"n": 0}

    def counted(_bytes: bytes) -> ProspectusParse:
        calls["n"] += 1
        return parse

    first, parsed_now_1 = ensure_parse(
        artifact_store=store,
        prospectus_id=name,
        pdf_bytes=_pdf_bytes(name),
        parse_fn=counted,
    )
    second, parsed_now_2 = ensure_parse(
        artifact_store=store,
        prospectus_id=name,
        pdf_bytes=_pdf_bytes(name),
        parse_fn=counted,
    )

    # Near-free re-run: the persisted parse is reused, not re-parsed (AC 2).
    assert parsed_now_1 is True
    assert parsed_now_2 is False
    assert calls["n"] == 1
    assert second.pdfSha256 == first.pdfSha256 == parse.pdfSha256


@pytest.mark.skipif(
    not NAMES, reason="corpus PDFs not present (.scratch/free-tier/demo-corpus)"
)
@pytest.mark.parametrize("name", NAMES)
def test_full_pipeline_on_real_pdf_with_fake_llm(
    parsed: dict[str, ProspectusParse], name: str
) -> None:
    """Ticket 05 AC 2 (offline half): all 5 sections + both insights on each real
    corpus prospectus, with the deterministic FakeLLMClient (NO network, no API key).

    Slow only because of the shared ``parsed`` fixture; the analysis
    itself is instant. Asserts the per-section input budget held on the real
    (fallback = whole-document) sections and the run stays under $2.
    """
    from tuju_ai.llm import CostTracker, FakeLLMClient
    from tuju_ai.prospectus.analysis import analyze_prospectus
    from tuju_ai.prospectus.analysis_models import IpoReference
    from tuju_ai.prospectus.budget import SECTION_CHAR_BUDGET

    parse = parsed[name]
    llm = FakeLLMClient(model="google/gemini-2.5-flash")
    tracker = CostTracker(model=llm.model, ceiling_usd=2.0)
    artifact = analyze_prospectus(
        prospectus_id=name,
        reference=IpoReference(
            id=name, companyName=name, prospectusS3Key=f"prospectus/{name}.pdf"
        ),
        parse=parse,
        routed=route_sections(parse),
        client=llm,
        tracker=tracker,
    )
    assert set(artifact["sections"]) == {
        "offer", "business", "financials", "riskFactors", "whatToWatch",
    }
    assert set(artifact["insights"]) == {"shariah", "cornerstone", "lockup", "relatedParty"}
    for name in ("offer", "business", "financials", "riskFactors"):
        routing = artifact["sections"][name]["routing"]
        assert routing["inputChars"] <= SECTION_CHAR_BUDGET + 2000, (name, routing)
    assert artifact["cost"]["estimatedCostUsd"] < 2.0
