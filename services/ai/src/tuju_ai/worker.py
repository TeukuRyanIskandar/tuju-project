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
from .backend_client import BackendClient, HttpBackendClient
from .config import QUEUE_ANALYSIS, Settings
from .contracts_generated import JobProgress
from .handler import TerminalJobError, handle_job
from .logging_config import configure_logging, get_logger


def _make_processor(artifact_store: ArtifactStore, backend_client: BackendClient):
    """Build the async BullMQ processor bound to the given artifact/backend clients."""

    async def process(job: Any, token: str) -> dict:
        async def report_progress(progress: JobProgress) -> None:
            # BullMQ native progress → QueueEvents.on('progress') (ADR-0007 §4).
            await job.updateProgress(progress.model_dump(mode="json"))

        loop = asyncio.get_running_loop()

        def sync_report(progress: JobProgress) -> None:
            # handle_job is sync; hop the async updateProgress onto the loop.
            asyncio.run_coroutine_threadsafe(report_progress(progress), loop)

        try:
            result = handle_job(
                job.name,
                job.data,
                artifact_store=artifact_store,
                report_progress=sync_report,
                backend_client=backend_client,
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
    artifact_store = ArtifactStore(settings)
    backend_client = HttpBackendClient(settings.backend_api_url)

    log.info(
        "worker.boot",
        extra={"queue": QUEUE_ANALYSIS, "redis": settings.redis_url},
    )
    worker = Worker(
        QUEUE_ANALYSIS,
        _make_processor(artifact_store, backend_client),
        {"connection": settings.redis_url},
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
