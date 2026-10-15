"""Shared helpers for running jobs through ``handle_job`` (no network/infra)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from botocore.exceptions import ClientError

from tuju_ai.artifacts import ArtifactStore
from tuju_ai.config import Settings
from tuju_ai.contracts_generated import JobProgress, JobResult
from tuju_ai.handler import handle_job
from tuju_ai.jobs.pipeline import JobDeps
from tuju_ai.llm import FakeLLMClient, LLMClient, LLMRuntime

BUCKET = "tuju-artifacts"
FIXTURES_DIR = (
    Path(__file__).resolve().parents[3] / "packages" / "contracts" / "fixtures"
)


def load(name: str) -> dict:
    return json.loads((FIXTURES_DIR / name).read_text(encoding="utf-8"))


class RecordingS3:
    """In-memory S3: records every ``put_object`` and serves ``get_object``."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.objects: dict[tuple[str, str], bytes] = {}
        self.gets: list[str] = []

    def put_object(self, **kwargs: Any) -> dict:
        self.calls.append(kwargs)
        self.objects[(kwargs["Bucket"], kwargs["Key"])] = kwargs["Body"]
        return {"ETag": '"fake"'}

    def get_object(self, *, Bucket: str, Key: str) -> dict:
        self.gets.append(Key)
        body = self.objects.get((Bucket, Key))
        if body is None:
            raise ClientError(
                {"Error": {"Code": "NoSuchKey", "Message": "nope"}}, "GetObject"
            )
        return {"Body": body}

    def artifact(self, key: str) -> dict:
        return json.loads(self.objects[(BUCKET, key)])


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


class UnusedBackend:
    """A ``BackendClient`` for jobs that must not read the backend."""

    def get_market_indices(self) -> dict:
        raise AssertionError("unexpected backend read")

    def get_announcement(self, announcement_id: str) -> dict:
        raise AssertionError("unexpected backend read")

    def get_ipo_reference(self, prospectus_id: str) -> dict:
        raise AssertionError("unexpected backend read")

    def get_analysis_reference(self, symbol: str) -> dict:
        raise AssertionError("unexpected backend read")


def deps(
    *,
    backend: Any = None,
    llm: LLMClient | None | bool = True,
    s3: RecordingS3 | None = None,
    **kw: Any,
) -> tuple[JobDeps, RecordingS3]:
    """``llm=True`` ⇒ a default ``FakeLLMClient``; ``llm=None`` ⇒ no key."""
    s3 = s3 or RecordingS3()
    client = FakeLLMClient() if llm is True else llm
    return (
        JobDeps(
            artifact_store=ArtifactStore(settings(), s3_client=s3),
            backend=backend or UnusedBackend(),
            llm=LLMRuntime(client=client),  # type: ignore[arg-type]
            **kw,
        ),
        s3,
    )


def run(
    job_name: str, envelope: dict, **kw: Any
) -> tuple[JobResult, list[JobProgress], RecordingS3]:
    job_deps, s3 = deps(**kw)
    progress: list[JobProgress] = []
    result = handle_job(
        job_name, envelope, deps=job_deps, report_progress=progress.append
    )
    return result, progress, s3
