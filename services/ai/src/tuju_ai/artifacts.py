"""S3 claim-check artifact store (ADR-0004).

Python writes the full analysis artifact to S3-compatible object storage
(LocalStack locally, S3/R2 in prod) under a scoped ``results``/``analysis``
prefix, and returns a pointer (bucket, key, sha256, bytes, contentType) over
BullMQ. Large payloads never ride the queue.

Write boundary (ADR-0004): Python is *write-only* to the scoped prefix and never
touches Postgres — NestJS is the sole relational writer.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

import boto3
from botocore.exceptions import ClientError

from .config import Settings
from .contracts_generated import ArtifactPointer

# S3 error codes that mean "no such object" for GET (LocalStack uses the
# standard NoSuchKey; a HEAD-shaped 404 code is tolerated too).
_NOT_FOUND_CODES = {"NoSuchKey", "404", "NotFound"}


class ArtifactStore:
    """Writes analysis artifacts to S3 and hands back a claim-check pointer."""

    def __init__(self, settings: Settings, s3_client: Any | None = None) -> None:
        self._settings = settings
        self._s3 = s3_client or boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            region_name=settings.s3_region,
        )

    def put_artifact(self, key_suffix: str, artifact: dict[str, Any]) -> ArtifactPointer:
        """Serialize ``artifact`` to JSON, PUT it to S3, return the pointer.

        ``key_suffix`` is appended to the configured scoped prefix so all writes
        stay inside the write boundary.
        """
        body = json.dumps(artifact, separators=(",", ":"), default=str).encode("utf-8")
        sha256 = hashlib.sha256(body).hexdigest()
        key = f"{self._settings.s3_prefix}/{key_suffix}"
        content_type = "application/json"

        self._s3.put_object(
            Bucket=self._settings.s3_bucket,
            Key=key,
            Body=body,
            ContentType=content_type,
        )

        return ArtifactPointer(
            bucket=self._settings.s3_bucket,
            key=key,
            sha256=sha256,
            bytes=len(body),
            contentType=content_type,
        )

    def get_artifact(self, key_suffix: str) -> dict[str, Any] | None:
        """Fetch and decode a previously PUT artifact, or ``None`` if absent.

        Read-side counterpart to :meth:`put_artifact`, used by the prospectus
        pipeline to reuse a persisted parse across re-runs (spec 06,
        ticket 04). Only the scoped prefix is addressable, so reads stay
        inside the same boundary as writes.
        """
        key = f"{self._settings.s3_prefix}/{key_suffix}"
        try:
            resp = self._s3.get_object(
                Bucket=self._settings.s3_bucket, Key=key
            )
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code")
            if code in _NOT_FOUND_CODES:
                return None
            raise
        body: Any = resp["Body"]
        if hasattr(body, "read"):  # real botocore StreamingBody
            body = body.read()
        return json.loads(body)

    def get_prospectus_pdf(self, s3_key: str) -> bytes | None:
        """Read one seeded prospectus PDF, or ``None`` if the object is absent.

        Narrowly scoped (spec 06, ticket 05): the seeded PDFs live under the
        ``prospectus/`` corpus prefix, outside the ``analysis/`` artifacts
        prefix that :meth:`get_artifact` is confined to. This method may ONLY
        read beneath ``settings.prospectus_s3_prefix`` (exact ``prefix/``
        match, no ``..`` segments) — it does not widen general read access,
        and there is no write counterpart.
        """
        prefix = self._settings.prospectus_s3_prefix.strip("/") + "/"
        if (
            not s3_key.startswith(prefix)
            or len(s3_key) == len(prefix)
            or ".." in s3_key.split("/")
        ):
            raise ValueError(
                f"refusing to read {s3_key!r}: outside the prospectus corpus "
                f"prefix {prefix!r}"
            )
        try:
            resp = self._s3.get_object(Bucket=self._settings.s3_bucket, Key=s3_key)
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code")
            if code in _NOT_FOUND_CODES:
                return None
            raise
        body: Any = resp["Body"]
        if hasattr(body, "read"):
            body = body.read()
        return bytes(body)
