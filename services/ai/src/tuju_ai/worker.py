"""BullMQ worker — the thin JobBus adapter (ADR-0001 seam).

App logic lives in :mod:`tuju_ai.handler`; this module only wires BullMQ to it:
consume the ``analysis`` queue, forward ``job.updateProgress`` as the progress
reporter, return the validated ``JobResult`` via ``job.returnvalue`` (ADR-0007
§7 — no dedicated results queue), and map a terminal error to no-retry.

Booting requires a live Redis (ADR-0006 connection-URL-by-env). The offline unit
layer never imports this module's async path — it tests :mod:`tuju_ai.handler`.
"""

from __future__ import annotations

import asyncio
import logging
import signal
from typing import Any

from bullmq import Worker

try:  # pragma: no cover - import shape varies across bullmq minor versions
    from bullmq import UnrecoverableError
except ImportError:  # pragma: no cover
    UnrecoverableError = RuntimeError  # type: ignore[assignment, misc]

from .artifacts import ArtifactStore
from .backend_client import HttpBackendClient
from .config import QUEUE_ANALYSIS, Settings
from .contracts_generated import JobProgress
from .errors import TerminalJobError
from .handler import handle_job
from .jobs.pipeline import JobDeps
from .llm import LLMRuntime
from .logging_config import configure_logging, get_logger


def _make_processor(deps: JobDeps):
    """Build the async BullMQ processor bound to the worker's job deps."""

    async def process(job: Any, token: str) -> dict:
        async def report_progress(progress: JobProgress) -> None:
            # BullMQ native progress → QueueEvents.on('progress') (ADR-0007 §4).
            await job.updateProgress(progress.model_dump(mode="json"))

        loop = asyncio.get_running_loop()

        def sync_report(progress: JobProgress) -> None:
            # handle_job is sync; hop the async updateProgress onto the loop.
            asyncio.run_coroutine_threadsafe(report_progress(progress), loop)

        try:
            # handle_job is sync and can block for MINUTES (analyze-prospectus
            # makes several sequential LLM calls). Run it in a thread so this event loop stays free to renew the BullMQ
            # job lock (bullmq's LockManager is an asyncio task on this loop)
            # and to flush progress updates. Blocking the loop here would let
            # the lock lapse and the job be re-queued as "stalled".
            result = await asyncio.to_thread(
                handle_job,
                job.name,
                job.data,
                deps=deps,
                report_progress=sync_report,
            )
        except TerminalJobError as exc:
            # Fail fast, no retry (ADR-0007 §6).
            raise UnrecoverableError(str(exc)) from exc

        # returnvalue = claim-check pointer + thin summary (ADR-0007 §5/§7).
        return result.model_dump(mode="json")

    return process


async def run() -> None:
    """Boot the worker and block until a termination signal arrives."""
    configure_logging()
    log = get_logger(__name__)
    settings = Settings.from_env()
    # The one LLM runtime (client, prices, per-job ceilings), built once.
    llm = LLMRuntime.from_settings(settings)
    if not llm.configured:
        log.warning(
            "worker.llm_not_configured",
            extra={"detail": "OPENROUTER_API_KEY unset: LLM jobs (TA/FA, prospectus) will fail terminally"},
        )

    log.info(
        "worker.boot",
        extra={"queue": QUEUE_ANALYSIS, "redis": settings.redis_url},
    )
    worker = Worker(
        QUEUE_ANALYSIS,
        _make_processor(
            JobDeps(
                artifact_store=ArtifactStore(settings),
                backend=HttpBackendClient(settings.backend_api_url),
                llm=llm,
            )
        ),
        {
            "connection": settings.redis_url,
            # Generous lock for the long analyze-prospectus job (renewed every
            # lockDuration/2 by bullmq's LockManager while the thread runs).
            "lockDuration": settings.worker_lock_duration_ms,
        },
    )

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:  # pragma: no cover - Windows
            pass

    await stop.wait()
    log.info("worker.shutdown")
    await worker.close()


def main() -> None:
    """Console-script entrypoint: ``uv run tuju-ai-worker``."""
    try:
        asyncio.run(run())
    except KeyboardInterrupt:  # pragma: no cover
        logging.getLogger(__name__).info("interrupted")


if __name__ == "__main__":  # pragma: no cover
    main()
