"""Unit tests for the prospectus parse store (spec 06, ticket 04).

Covers the idempotent parse-claim-check seam: the Docling parse is persisted
as an S3 claim-check artifact keyed by prospectus (ADR-0004), and a re-run
against the SAME PDF reuses the persisted parse — no re-parse, near-free
(ticket 04 AC 2). A changed PDF (sha mismatch under the same prospectus id)
re-parses.

Infra-free: S3 is faked in-memory (house ``FakeS3`` pattern), the Docling
parse is injected and counted (docling is never imported in this lane).
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Callable

import pytest
from botocore.exceptions import ClientError

from tuju_ai.artifacts import ArtifactStore
from tuju_ai.config import Settings
from tuju_ai.prospectus.models import ProspectusParse

pytestmark = pytest.mark.unit

BUCKET = "tuju-artifacts"
PREFIX = "analysis"


class FakeS3:
    """In-memory S3 with the ``get_object``/``put_object`` surface the seam uses."""

    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}
        self.puts: list[dict[str, Any]] = []

    def put_object(
        self, *, Bucket: str, Key: str, Body: bytes, **_: Any
    ) -> dict:
        self.objects[(Bucket, Key)] = Body
        self.puts.append({"Bucket": Bucket, "Key": Key, "Body": Body})
        return {"ETag": '"fake"'}

    def get_object(self, *, Bucket: str, Key: str) -> dict:
        body = self.objects.get((Bucket, Key))
        if body is None:
            # Shape-compatible with botocore's NoSuchKey ClientError.
            raise ClientError(
                {"Error": {"Code": "NoSuchKey", "Message": "Not Found"}},
                "GetObject",
            )
        return {"Body": body}


def _settings() -> Settings:
    return Settings(
        redis_url="redis://unused",
        s3_endpoint_url="http://localstack:4566",
        s3_region="ap-southeast-1",
        s3_bucket=BUCKET,
        s3_prefix=PREFIX,
        backend_api_url="http://backend-unused",
    )


def _counted_parse(
    counter: dict[str, int],
) -> Callable[[bytes], ProspectusParse]:
    """A counted stand-in for the Docling parse (never imported in this lane)."""

    def parse(pdf_bytes: bytes) -> ProspectusParse:
        counter["calls"] += 1
        return ProspectusParse(
            pdfSha256=hashlib.sha256(pdf_bytes).hexdigest(),
            headings=[],
            blocks=[],
        )

    return parse


def _pdf(body: str) -> bytes:
    return body.encode("utf-8")


def _stored(fake: FakeS3, key: str) -> dict:
    return json.loads(fake.objects[(BUCKET, f"{PREFIX}/{key}")])


def test_first_run_parses_and_persists_under_prospectus_key() -> None:
    from tuju_ai.prospectus.store import ensure_parse, parse_artifact_key

    fake = FakeS3()
    store = ArtifactStore(_settings(), s3_client=fake)
    counter = {"calls": 0}

    parse, parsed_now = ensure_parse(
        artifact_store=store,
        prospectus_id="ipo-1",
        pdf_bytes=_pdf("%PDF-1.4 first"),
        parse_fn=_counted_parse(counter),
    )

    assert parsed_now is True
    assert counter["calls"] == 1
    # Claim-checked under the scoped prefix, keyed by prospectus (ADR-0004).
    key = parse_artifact_key("ipo-1")
    assert f"{PREFIX}/{key}" in [p["Key"] for p in fake.puts]
    # The persisted body round-trips as a valid parse carrying the PDF sha.
    stored = ProspectusParse.model_validate(_stored(fake, key))
    assert stored.pdfSha256 == parse.pdfSha256


def test_re_run_reuses_persisted_parse_no_reparse() -> None:
    from tuju_ai.prospectus.store import ensure_parse

    fake = FakeS3()
    store = ArtifactStore(_settings(), s3_client=fake)
    counter = {"calls": 0}
    parse_fn = _counted_parse(counter)
    pdf = _pdf("%PDF-1.4 same-document")

    first, parsed_now_1 = ensure_parse(
        artifact_store=store,
        prospectus_id="ipo-1",
        pdf_bytes=pdf,
        parse_fn=parse_fn,
    )
    second, parsed_now_2 = ensure_parse(
        artifact_store=store,
        prospectus_id="ipo-1",
        pdf_bytes=pdf,
        parse_fn=parse_fn,
    )

    # The second run is near-free: no re-parse, no re-put, same parse back.
    assert parsed_now_1 is True and parsed_now_2 is False
    assert counter["calls"] == 1
    assert len(fake.puts) == 1
    assert second == first


def test_changed_pdf_under_same_id_reparse() -> None:
    from tuju_ai.prospectus.store import ensure_parse, parse_artifact_key

    fake = FakeS3()
    store = ArtifactStore(_settings(), s3_client=fake)
    counter = {"calls": 0}
    parse_fn = _counted_parse(counter)

    first, _ = ensure_parse(
        artifact_store=store,
        prospectus_id="ipo-1",
        pdf_bytes=_pdf("%PDF-1.4 v1"),
        parse_fn=parse_fn,
    )
    second, parsed_now_2 = ensure_parse(
        artifact_store=store,
        prospectus_id="ipo-1",
        pdf_bytes=_pdf("%PDF-1.4 v2 revised"),
        parse_fn=parse_fn,
    )

    # The sha mismatch invalidates the stale parse: re-parse, same key.
    assert parsed_now_2 is True
    assert counter["calls"] == 2
    assert len(fake.puts) == 2
    assert fake.puts[0]["Key"] == fake.puts[1]["Key"]
    assert second.pdfSha256 != first.pdfSha256
    assert _stored(fake, parse_artifact_key("ipo-1"))["pdfSha256"] == (
        second.pdfSha256
    )
