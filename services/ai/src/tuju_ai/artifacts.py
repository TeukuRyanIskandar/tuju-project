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

from .config import Settings
from .contracts_generated import ArtifactPointer


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
