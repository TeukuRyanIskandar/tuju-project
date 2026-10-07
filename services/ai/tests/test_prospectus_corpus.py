"""Corpus-lane test: the real demo-corpus prospectus PDFs (spec 06, ticket 04).

Ticket 04's acceptance criterion 1: running the parser against EACH of the 3
real 2025 Bursa IPO prospectus PDFs (the manually-curated corpus, tracked in
git at ``.scratch/free-tier/demo-corpus/prospectuses/``) locates — or
explicitly falls back for — all four regulated sections.

This lane is marked ``corpus``: it needs the ``parse`` extra (Docling +
torch) and downloads Docling's layout models on first run, so it is deselected
from both the unit/PR lane and the testcontainers integration lane and run
explicitly with ``uv run --project services/ai pytest -m corpus`` (the
version pinning the routing reality per document lives here, tuned against
the corpus with ``scripts/inspect_corpus.py``).
"""

from __future__ import annotations

from hashlib import sha256
from pathlib import Path

import pytest

pytestmark = [pytest.mark.corpus]

# Docling lives in the optional `parse` extra; skip (not error) without it.
pytest.importorskip(
    "docling", reason="corpus lane needs the `parse` extra (uv sync --extra parse)"
)

from tuju_ai.artifacts import ArtifactStore
from tuju_ai.config import Settings
from tuju_ai.prospectus.models import ProspectusParse, ProspectusSection
from tuju_ai.prospectus.parsing import parse_prospectus
from tuju_ai.prospectus.router import route_sections
from tuju_ai.prospectus.store import ensure_parse

CORPUS_DIR = (
    Path(__file__).resolve().parents[3]
    / ".scratch"
    / "free-tier"
    / "demo-corpus"
    / "prospectuses"
)

PDFS = sorted(CORPUS_DIR.glob("*.pdf"))


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


# Routing reality pinned per document (tuned with scripts/inspect_corpus.py).
# Every section is located except Fibromat's business chapter: the demo corpus
# is Part-1-only and Fibromat's "Business Overview" chapter lives in Part 2,
# so the router must fall back to whole-document content there, explicitly.
EXPECTED_FALLBACKS: dict[str, set[ProspectusSection]] = {
    "fbbhd_fibromat-m-berhad_2025-04-11_part1.pdf": {ProspectusSection.BUSINESS},
    "iab_insights-analytics-berhad_2025-10-07_part1.pdf": set(),
    "lsh_lim-seong-ha-capital-berhad_2025_part1of3.pdf": set(),
}


@pytest.fixture(scope="module")
def parsed() -> dict[str, ProspectusParse]:
    """Parse each real PDF ONCE (the expensive Docling pass) for the module."""
    return {pdf.name: parse_prospectus(pdf.read_bytes()) for pdf in PDFS}


@pytest.mark.skipif(
    not PDFS, reason="corpus PDFs not present (.scratch/free-tier/demo-corpus)"
)
@pytest.mark.parametrize("pdf", PDFS, ids=lambda p: p.name)
def test_real_prospectus_routes_all_four_sections(
    parsed: dict[str, ProspectusParse], pdf: Path
) -> None:
    parse = parsed[pdf.name]
    assert parse.headings, "Docling found no headings in a real prospectus"
    assert parse.blocks, "Docling found no content blocks in a real prospectus"
    # The parse is keyed to the exact PDF bytes (idempotency anchor).
    assert parse.pdfSha256 == sha256(pdf.read_bytes()).hexdigest()

    routed = route_sections(parse)
    assert set(routed) == set(ProspectusSection)

    for section in ProspectusSection:
        result = routed[section]
        assert result.located is (section not in EXPECTED_FALLBACKS[pdf.name]), (
            f"{pdf.name}: {section.value} located={result.located}, "
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
    not PDFS, reason="corpus PDFs not present (.scratch/free-tier/demo-corpus)"
)
@pytest.mark.parametrize("pdf", PDFS, ids=lambda p: p.name)
def test_re_run_reuses_parse_no_reparse_for_real_pdfs(
    parsed: dict[str, ProspectusParse], pdf: Path
) -> None:
    parse = parsed[pdf.name]
    store = ArtifactStore(_settings(), s3_client=InMemoryS3())
    calls = {"n": 0}

    def counted(_bytes: bytes) -> ProspectusParse:
        calls["n"] += 1
        return parse

    first, parsed_now_1 = ensure_parse(
        artifact_store=store,
        prospectus_id=pdf.stem,
        pdf_bytes=pdf.read_bytes(),
        parse_fn=counted,
    )
    second, parsed_now_2 = ensure_parse(
        artifact_store=store,
        prospectus_id=pdf.stem,
        pdf_bytes=pdf.read_bytes(),
        parse_fn=counted,
    )

    # Near-free re-run: the persisted parse is reused, not re-parsed (AC 2).
    assert parsed_now_1 is True
    assert parsed_now_2 is False
    assert calls["n"] == 1
    assert second.pdfSha256 == first.pdfSha256 == parse.pdfSha256


@pytest.mark.skipif(
    not PDFS, reason="corpus PDFs not present (.scratch/free-tier/demo-corpus)"
)
@pytest.mark.parametrize("pdf", PDFS, ids=lambda p: p.name)
def test_full_pipeline_on_real_pdf_with_fake_llm(
    parsed: dict[str, ProspectusParse], pdf: Path
) -> None:
    """Ticket 05 AC 2 (offline half): all 5 sections + both insights on each real
    corpus PDF, with the deterministic FakeLLMClient (NO network, no API key).

    Slow only because of the shared Docling ``parsed`` fixture; the analysis
    itself is instant. Asserts the per-section input budget held on the real
    (fallback = whole-document) sections and the run stays under $2.
    """
    from tuju_ai.llm import CostTracker, FakeLLMClient
    from tuju_ai.prospectus.analysis import analyze_prospectus
    from tuju_ai.prospectus.analysis_models import IpoReference
    from tuju_ai.prospectus.budget import SECTION_CHAR_BUDGET

    parse = parsed[pdf.name]
    llm = FakeLLMClient(model="google/gemini-2.5-flash")
    tracker = CostTracker(model=llm.model, ceiling_usd=2.0)
    artifact = analyze_prospectus(
        prospectus_id=pdf.stem,
        reference=IpoReference(
            id=pdf.stem, companyName=pdf.stem, prospectusS3Key=f"prospectus/{pdf.name}"
        ),
        parse=parse,
        routed=route_sections(parse),
        client=llm,
        tracker=tracker,
    )
    assert set(artifact["sections"]) == {
        "offer", "business", "financials", "riskFactors", "whatToWatch",
    }
    assert set(artifact["insights"]) == {"shariah", "cornerstone"}
    for name in ("offer", "business", "financials", "riskFactors"):
        routing = artifact["sections"][name]["routing"]
        assert routing["inputChars"] <= SECTION_CHAR_BUDGET + 2000, (name, routing)
    assert artifact["cost"]["estimatedCostUsd"] < 2.0
