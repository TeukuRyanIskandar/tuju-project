"""Shared helpers for the ticket-05 prospectus-analysis tests (no network/infra)."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from botocore.exceptions import ClientError

from tuju_ai.artifacts import ArtifactStore
from tuju_ai.config import Settings
from tuju_ai.prospectus.models import Block, Heading, ProspectusParse

BUCKET = "tuju-artifacts"
PDF_KEY = "prospectus/Fake-Prospectus.pdf"
PDF_BYTES = b"%PDF-1.7 fake prospectus bytes"
PROSPECTUS_ID = "5f3c1a2e-9b7d-4e1a-8c3f-2d6b7a9e0f41"


class MemoryS3:
    """In-memory S3 with put/get (house FakeS3 pattern)."""

    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}
        self.gets: list[str] = []

    def put_object(self, *, Bucket: str, Key: str, Body: bytes, **_: Any) -> dict:
        self.objects[(Bucket, Key)] = Body
        return {"ETag": '"fake"'}

    def get_object(self, *, Bucket: str, Key: str) -> dict:
        self.gets.append(Key)
        body = self.objects.get((Bucket, Key))
        if body is None:
            raise ClientError(
                {"Error": {"Code": "NoSuchKey", "Message": "nope"}}, "GetObject"
            )
        return {"Body": body}


def settings(**overrides: Any) -> Settings:
    return Settings(
        redis_url="redis://unused",
        s3_endpoint_url="http://localstack:4566",
        s3_region="ap-southeast-1",
        s3_bucket=BUCKET,
        s3_prefix="analysis",
        backend_api_url="http://backend-unused",
        **overrides,
    )


def make_parse(pdf_bytes: bytes = PDF_BYTES, *, with_cornerstone: bool = True) -> ProspectusParse:
    """A Bursa-style parse: offer/business/financials located, risk missing (fallback)."""
    items: list[tuple[str, str, int]] = [
        ("h", "1. Introduction", 1),
        ("t", "About this prospectus.", 0),
        ("h", "2. Details of our IPO", 1),
        ("t", "We are offering 150,000,000 shares at RM0.50 per share.", 0),
        ("h", "2.1 Utilisation of Proceeds", 2),
        ("t", "RM35 million for capacity expansion.", 0),
        ("h", "3. Business Overview", 1),
        ("t", "We manufacture industrial components.", 0),
        ("h", "4. Financial Highlights", 1),
        ("t", "Revenue grew from RM100m to RM150m.", 0),
    ]
    if with_cornerstone:
        items += [
            ("h", "5. Plan of Distribution", 1),
            ("t", "Two cornerstone investors have agreed to subscribe for shares.", 0),
        ]
    headings: list[Heading] = []
    blocks: list[Block] = []
    for kind, text, level in items:
        if kind == "h":
            headings.append(Heading(text=text, level=level, index=len(headings)))
        else:
            blocks.append(
                Block(kind="text", text=text, headingIndex=headings[-1].index)
            )
    return ProspectusParse(
        pdfSha256=hashlib.sha256(pdf_bytes).hexdigest(),
        headings=headings,
        blocks=blocks,
    )


def ipo_reference(**overrides: Any) -> dict[str, Any]:
    ref: dict[str, Any] = {
        "id": PROSPECTUS_ID,
        "companyName": "Fake Industries Berhad",
        "board": "ACE",
        "listingDate": "2025-06-30",
        "prospectusS3Key": PDF_KEY,
        "shariahStatus": "compliant",
    }
    ref.update(overrides)
    return ref


class FakeBackend:
    """Canned NestJS reads; records the ipo-reference lookups."""

    def __init__(self, reference: dict[str, Any] | Exception | None = None) -> None:
        self.reference = ipo_reference() if reference is None else reference
        self.reference_calls: list[str] = []

    def get_market_indices(self) -> dict:  # pragma: no cover - unused here
        raise AssertionError("prospectus job must not read market indices")

    def get_announcement(self, announcement_id: str) -> dict:  # pragma: no cover
        raise AssertionError("prospectus job must not read announcements")

    def get_ipo_reference(self, prospectus_id: str) -> dict:
        self.reference_calls.append(prospectus_id)
        if isinstance(self.reference, Exception):
            raise self.reference
        return self.reference


def envelope(prospectus_id: str = PROSPECTUS_ID) -> dict:
    return {
        "correlationId": "0b1f3a52-8e5c-4c58-9a51-6f0c2f9b7d14",
        "requestedBy": "system",
        "trigger": "system",
        "asOf": "2026-10-07T02:00:00Z",
        "payload": {"prospectusId": prospectus_id},
    }


def store_with_pdf(fake: MemoryS3 | None = None) -> tuple[ArtifactStore, MemoryS3]:
    fake = fake or MemoryS3()
    fake.objects[(BUCKET, PDF_KEY)] = PDF_BYTES
    return ArtifactStore(settings(), s3_client=fake), fake


def stored_artifact(fake: MemoryS3, key: str) -> dict:
    return json.loads(fake.objects[(BUCKET, key)])
