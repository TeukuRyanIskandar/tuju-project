"""Worker-adapter tests for ``analyze-prospectus`` (spec 06, ticket 05).

Proves the BullMQ processor (a) runs the blocking handler OFF the event loop —
so bullmq's asyncio lock-renewal task keeps running during the 4-11 min
first-run parse — (b) maps terminal failures to ``UnrecoverableError`` (no
retry) and (c) lets transient failures propagate (BullMQ retries).
"""

from __future__ import annotations

import asyncio
import threading
import time

import pytest

from prospectus_helpers import (
    PROSPECTUS_ID,
    FakeBackend,
    envelope,
    make_parse,
    store_with_pdf,
)
from tuju_ai.jobs.pipeline import JobDeps
from tuju_ai.llm import FakeLLMClient, LLMRuntime, LLMTransientError
from tuju_ai.worker import UnrecoverableError, _make_processor
from tuju_ai.config import DEFAULT_WORKER_LOCK_DURATION_MS

pytestmark = pytest.mark.unit


class StubJob:
    name = "analyze-prospectus"

    def __init__(self, data: dict) -> None:
        self.data = data
        self.progress: list[dict] = []

    async def updateProgress(self, progress: dict) -> None:
        self.progress.append(progress)


def test_blocking_parse_does_not_block_the_event_loop() -> None:
    main_thread = threading.get_ident()
    parse_thread: list[int] = []

    def slow_parse(pdf_bytes: bytes):
        parse_thread.append(threading.get_ident())
        time.sleep(0.4)
        return make_parse(pdf_bytes)

    store, _fake = store_with_pdf()
    process = _make_processor(
        JobDeps(store, FakeBackend(), LLMRuntime(client=FakeLLMClient()), parse_fn=slow_parse)
    )

    async def scenario() -> tuple[dict, int]:
        ticks = 0

        async def ticker() -> None:  # stands in for bullmq's lock renewal task
            nonlocal ticks
            while True:
                await asyncio.sleep(0.05)
                ticks += 1

        task = asyncio.create_task(ticker())
        try:
            result = await process(StubJob(envelope()), "token")
        finally:
            task.cancel()
        return result, ticks

    result, ticks = asyncio.run(scenario())
    assert parse_thread and parse_thread[0] != main_thread  # ran in a worker thread
    assert ticks >= 5  # the loop stayed responsive through the 0.4 s parse
    assert result["jobId"] == f"prospectus:{PROSPECTUS_ID}"
    assert "verdict" not in result["summary"]


def test_terminal_error_maps_to_unrecoverable() -> None:
    store, _fake = store_with_pdf()
    process = _make_processor(JobDeps(store, FakeBackend(), LLMRuntime(client=None)))
    with pytest.raises(UnrecoverableError, match="OPENROUTER_API_KEY"):
        asyncio.run(process(StubJob(envelope()), "token"))


def test_transient_error_is_not_unrecoverable() -> None:
    class Flaky(FakeLLMClient):
        def complete(self, messages, **kw):  # type: ignore[override]
            raise LLMTransientError("429")

    store, _fake = store_with_pdf()
    process = _make_processor(
        JobDeps(store, FakeBackend(), LLMRuntime(client=Flaky()), parse_fn=make_parse)
    )
    with pytest.raises(LLMTransientError):
        asyncio.run(process(StubJob(envelope()), "token"))


def test_lock_duration_default_covers_a_long_parse() -> None:
    # 5 min lock renewed every 2.5 min by the (free) event loop; see worker.py.
    assert DEFAULT_WORKER_LOCK_DURATION_MS >= 5 * 60 * 1000
