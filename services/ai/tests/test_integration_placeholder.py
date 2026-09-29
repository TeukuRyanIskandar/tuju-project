"""Integration placeholder (ADR-0011) — real Redis + LocalStack S3 via testcontainers.

Marked ``integration`` and skipped unless explicitly selected, so the unit layer
runs with no live infra. Ticket 07 (CI + test harness) wires the actual
testcontainers spin-up (a Redis container + a LocalStack S3 container), enqueues a
job on the ``analysis`` queue from a BullMQ producer, and asserts the worker
returns a contract-valid JobResult with the artifact present in S3.

Run explicitly with:  uv run pytest -m integration
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.integration


@pytest.mark.skip(reason="testcontainers harness lands in scaffold ticket 07")
def test_end_to_end_over_redis_and_localstack() -> None:
    # Planned shape (ticket 07):
    #   1. start Redis + LocalStack containers (testcontainers)
    #   2. create the 'tuju-artifacts' bucket
    #   3. enqueue an 'analyze-technical' job with a fixture envelope
    #   4. boot the worker against the container Redis/S3 URLs (by env)
    #   5. assert job.returnvalue is a contract-valid JobResult
    #   6. assert the artifact object exists at pointer.bucket/pointer.key
    raise AssertionError("placeholder — not implemented until ticket 07")
