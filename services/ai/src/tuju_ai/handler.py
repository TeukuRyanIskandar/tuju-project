"""Job dispatch: a job name → its :class:`~tuju_ai.jobs.pipeline.JobDefinition`.

This is the testable core of the worker, independent of BullMQ/Redis. Every
job runs through :func:`tuju_ai.jobs.pipeline.run_job` (validate → progress →
``work()`` → contract pre-write check → claim-check → ``JobResult``); the
job-specific code lives next to each family's domain code.

The worker stays a stateless reader (ADR-0004): it never writes Postgres, and
fetches whatever Postgres-backed context a job needs via the injected
``BackendClient`` (NestJS's own anonymous read endpoints).
"""

from __future__ import annotations

from .announcement_summary import ANNOUNCEMENT_SUMMARY_JOB
from .contracts_generated import JobResult
from .errors import TerminalJobError
from .jobs.pipeline import JobDefinition, JobDeps, ProgressReporter, run_job
from .market_brief import MARKET_BRIEF_JOB
from .prospectus.job import PROSPECTUS_JOB
from .ta_fa_analysis import FUNDAMENTAL_JOB, TECHNICAL_JOB

DEFINITIONS: dict[str, JobDefinition] = {
    d.name: d
    for d in (
        TECHNICAL_JOB,
        FUNDAMENTAL_JOB,
        MARKET_BRIEF_JOB,
        ANNOUNCEMENT_SUMMARY_JOB,
        PROSPECTUS_JOB,
    )
}


def handle_job(
    job_name: str,
    raw_envelope: dict,
    *,
    deps: JobDeps,
    report_progress: ProgressReporter,
) -> JobResult:
    """Process one job and return a contract-valid ``JobResult``.

    ``raw_envelope`` is the untrusted wire payload. An unknown ``job_name`` is
    terminal.
    """
    definition = DEFINITIONS.get(job_name)
    if definition is None:
        raise TerminalJobError(f"Unknown job name: {job_name!r}")
    return run_job(definition, raw_envelope, deps, report_progress)
