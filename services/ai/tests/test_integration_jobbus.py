"""Integration test (ADR-0011) — real Redis + LocalStack S3 via testcontainers.

This is the ADR-0011 highest-value seam on the Python side: the JobBus
enqueue → process → result round-trip over **real infra**, not mocks. It brings
up a throwaway Redis container and a throwaway LocalStack (S3) container with
the ``testcontainers`` library (the same stack ADR-0006 runs in compose), then:

    1. creates the ``tuju-artifacts`` bucket in LocalStack,
    2. enqueues an ``analyze-technical`` job with a fixture envelope onto the
       ``analysis`` queue via a BullMQ producer,
    3. boots the worker's real processor against the container Redis/S3,
    4. asserts ``job.returnvalue`` is a contract-valid ``JobResult``,
    5. asserts the claim-checked artifact object exists at pointer.bucket/key.

Marked ``integration`` so it is DESELECTED from the unit/PR lane (which must stay
infra-free) and runs only in the CI integration lane (``pytest -m integration``)
or locally when Docker is available.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import boto3
import pytest

pytestmark = pytest.mark.integration

# testcontainers + docker are only importable/usable in the integration lane.
# Skip cleanly (rather than error) if the harness deps or a Docker daemon are
# absent, so a developer without Docker can still run `pytest -m "not integration"`.
docker = pytest.importorskip("docker", reason="integration lane requires docker")
_redis_mod = pytest.importorskip(
    "testcontainers.redis", reason="integration lane requires testcontainers"
)
_localstack_mod = pytest.importorskip(
    "testcontainers.localstack",
    reason="integration lane requires testcontainers[localstack]",
)
RedisContainer = _redis_mod.RedisContainer
LocalStackContainer = _localstack_mod.LocalStackContainer

from tuju_ai.artifacts import ArtifactStore  # noqa: E402
from tuju_ai.config import JOB_ANALYZE_TECHNICAL, QUEUE_ANALYSIS, Settings  # noqa: E402
from tuju_ai.contracts_generated import JobResult  # noqa: E402
from tuju_ai.handler import handle_job  # noqa: E402

FIXTURES_DIR = (
    Path(__file__).resolve().parents[3] / "packages" / "contracts" / "fixtures"
)
BUCKET = "tuju-artifacts"


def _docker_available() -> bool:
    try:
        docker.from_env().ping()
        return True
    except Exception:  # pragma: no cover - environment probe
        return False


# Belt-and-braces: even with the libs installed, skip if no daemon is reachable.
pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not _docker_available(), reason="no reachable Docker daemon"
    ),
]


@pytest.fixture(scope="module")
def redis_url() -> str:
    with RedisContainer("redis:7.4-alpine") as redis:
        host = redis.get_container_host_ip()
        port = redis.get_exposed_port(6379)
        yield f"redis://{host}:{port}"


@pytest.fixture(scope="module")
def s3_endpoint() -> str:
    with LocalStackContainer("localstack/localstack:3").with_services("s3") as ls:
        yield ls.get_url()


@pytest.fixture(scope="module")
def settings(redis_url: str, s3_endpoint: str) -> Settings:
    return Settings(
        redis_url=redis_url,
        s3_endpoint_url=s3_endpoint,
        s3_region="ap-southeast-1",
        s3_bucket=BUCKET,
        s3_prefix="analysis",
        backend_api_url="http://backend-unused",
    )


@pytest.fixture(scope="module")
def s3_client(settings: Settings):
    client = boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        region_name=settings.s3_region,
        aws_access_key_id="test",
        aws_secret_access_key="test",
    )
    client.create_bucket(
        Bucket=BUCKET,
        CreateBucketConfiguration={"LocationConstraint": settings.s3_region},
    )
    return client


def _load(name: str) -> dict:
    return json.loads((FIXTURES_DIR / name).read_text(encoding="utf-8"))


class _UnusedBackendClient:
    """Stand-in `BackendClient` — this test only exercises the TA job, which
    never calls it."""

    def get_market_indices(self) -> dict:
        raise AssertionError("analyze-technical must not call the backend client")

    def get_announcement(self, announcement_id: str) -> dict:
        raise AssertionError("analyze-technical must not call the backend client")


def test_round_trip_over_redis_and_localstack(
    settings: Settings, s3_client
) -> None:
    """enqueue → worker processes → contract-valid JobResult + artifact in S3."""
    from bullmq import Queue, Worker

    envelope = _load("technical-job-envelope.json")

    async def scenario() -> JobResult:
        queue = Queue(QUEUE_ANALYSIS, {"connection": settings.redis_url})

        # Artifact store bound to the container LocalStack (real S3 PUTs).
        artifact_store = ArtifactStore(settings, s3_client=s3_client)

        done: asyncio.Future = asyncio.get_running_loop().create_future()

        async def process(job, token):
            loop = asyncio.get_running_loop()

            def report(progress):  # progress reporter is fire-and-forget here
                asyncio.run_coroutine_threadsafe(
                    job.updateProgress(progress.model_dump(mode="json")), loop
                )

            result = handle_job(
                job.name,
                job.data,
                artifact_store=artifact_store,
                report_progress=report,
                backend_client=_UnusedBackendClient(),
            )
            payload = result.model_dump(mode="json")
            if not done.done():
                done.set_result(result)
            return payload

        worker = Worker(
            QUEUE_ANALYSIS, process, {"connection": settings.redis_url}
        )
        try:
            await queue.add(JOB_ANALYZE_TECHNICAL, envelope)
            result = await asyncio.wait_for(done, timeout=30)
            return result
        finally:
            await worker.close()
            await queue.close()

    result = asyncio.run(scenario())

    # 1. Contract-valid JobResult (re-validate the round trip end to end).
    JobResult.model_validate(result.model_dump(mode="json"))
    assert result.jobId.startswith("ta:MAYBANK:1D:")
    assert result.summary.verdict in ("bullish", "bearish", "neutral")

    # 2. The claim-checked artifact really landed in S3 at the pointer.
    head = s3_client.head_object(
        Bucket=result.pointer.bucket, Key=result.pointer.key
    )
    assert head["ContentLength"] == result.pointer.bytes
    assert result.pointer.key.startswith("analysis/ta/MAYBANK/")


class _PdfBackendClient:
    """Serves the IPO reference row; the other reads are unused here."""

    def __init__(self, reference: dict) -> None:
        self._reference = reference

    def get_market_indices(self) -> dict:
        raise AssertionError("unused")

    def get_announcement(self, announcement_id: str) -> dict:
        raise AssertionError("unused")

    def get_ipo_reference(self, prospectus_id: str) -> dict:
        return self._reference


def test_prospectus_round_trip_over_redis_and_localstack(
    settings: Settings, s3_client
) -> None:
    """enqueue analyze-prospectus → PDF read from `prospectus/` → parse claim-check
    → fake-LLM analysis → at-a-glance artifact in S3 + verdict-less result.

    Fake LLM and a stand-in parse (no Docling, no network beyond containers).
    """
    import hashlib

    from bullmq import Queue, Worker

    from tuju_ai.config import JOB_ANALYZE_PROSPECTUS
    from tuju_ai.llm import FakeLLMClient
    from tuju_ai.prospectus.job import ProspectusRuntime
    from tuju_ai.prospectus.models import Block, Heading, ProspectusParse

    pdf = b"%PDF-1.7 integration prospectus"
    prospectus_id = "it-prospectus-1"
    s3_client.put_object(Bucket=BUCKET, Key="prospectus/it.pdf", Body=pdf)
    envelope = _load("prospectus-job-envelope.json")
    envelope["payload"]["prospectusId"] = prospectus_id

    def parse_fn(pdf_bytes: bytes) -> ProspectusParse:
        return ProspectusParse(
            pdfSha256=hashlib.sha256(pdf_bytes).hexdigest(),
            headings=[Heading(text="2. Risk Factors", level=1, index=0)],
            blocks=[
                Block(kind="text", text="Customer concentration risk.", headingIndex=0),
                Block(kind="text", text="A cornerstone investor subscribed.", headingIndex=0),
            ],
        )

    backend = _PdfBackendClient(
        {
            "id": prospectus_id,
            "companyName": "IT Berhad",
            "board": "ACE",
            "listingDate": None,
            "prospectusS3Key": "prospectus/it.pdf",
            "shariahStatus": None,
        }
    )
    runtime = ProspectusRuntime(llm_client=FakeLLMClient(), parse_fn=parse_fn)

    async def scenario() -> JobResult:
        queue = Queue(QUEUE_ANALYSIS, {"connection": settings.redis_url})
        artifact_store = ArtifactStore(settings, s3_client=s3_client)
        done: asyncio.Future = asyncio.get_running_loop().create_future()

        async def process(job, token):
            result = await asyncio.to_thread(
                handle_job,
                job.name,
                job.data,
                artifact_store=artifact_store,
                report_progress=lambda _p: None,
                backend_client=backend,
                prospectus_runtime=runtime,
            )
            if not done.done():
                done.set_result(result)
            return result.model_dump(mode="json")

        worker = Worker(QUEUE_ANALYSIS, process, {"connection": settings.redis_url})
        try:
            await queue.add(JOB_ANALYZE_PROSPECTUS, envelope)
            return await asyncio.wait_for(done, timeout=30)
        finally:
            await worker.close()
            await queue.close()

    result = asyncio.run(scenario())

    JobResult.model_validate(result.model_dump(mode="json"))
    assert result.jobId == f"prospectus:{prospectus_id}"
    assert "verdict" not in result.model_dump(mode="json")["summary"]
    assert result.pointer.key == f"analysis/prospectus/{prospectus_id}/at-a-glance.json"
    body = json.loads(
        s3_client.get_object(Bucket=BUCKET, Key=result.pointer.key)["Body"].read()
    )
    assert body["provenance"]["source"] == "real"
    assert set(body["sections"]) == {
        "offer", "business", "financials", "riskFactors", "whatToWatch",
    }
    # parse was claim-checked for reuse
    s3_client.head_object(
        Bucket=BUCKET, Key=f"analysis/prospectus/{prospectus_id}/parse.json"
    )
