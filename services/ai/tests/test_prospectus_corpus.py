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
    )


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
