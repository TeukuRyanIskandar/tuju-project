"""The job pipeline: one run path for every job family (ticket 02).

:func:`run_job` owns everything the job families used to hand-copy:

1. validate the incoming envelope against its generated Pydantic model
   (runtime conformance, ADR-0011) — a bad envelope is terminal;
2. mint the ``JobResult.jobId`` from the job registry's colon prefix
   (``JOBS[name].result_id_prefix``) + the family's content-derived key
   (ADR-0007 §2);
3. emit step-based progress (ADR-0007 §4) over a plan whose phases are
   checked against the registry's ``phases`` when the definition is built:
   ``queued`` → the family's work steps → ``persisting-artifact`` → ``done``;
4. run the family's ``work()``, mapping LLM failures to ADR-0007 §6 classes;
5. validate the artifact against its generated contract model BEFORE the S3
   write (ADR-0014 §3) — a mismatch is terminal and nothing is written;
6. claim-check the artifact to S3 (ADR-0004) and return a validated,
   verdict-less ``JobResult`` (pointer + ``SystemSummary``, ADR-0007 §5).

A family's job-specific code is only its :class:`JobDefinition` and ``work()``,
which returns a :class:`JobOutput` and reports progress through
:class:`JobContext`.

Failure classes: :class:`~tuju_ai.errors.TerminalJobError` (and the LLM
config/permanent/still-unusable/cost-ceiling errors mapped to it) is
non-retryable; everything else (backend 5xx, LLM timeouts/429s) propagates and
BullMQ retries it.
"""

from __future__ import annotations

import threading
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Generic, Iterator, Sequence, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from ..artifacts import ArtifactStore
from ..backend_client import BackendClient
from ..contracts_generated import JobProgress, JobResult, SystemSummary
from ..contracts_generated.job_registry import JOBS
from ..errors import TerminalJobError
from ..llm import (
    CostCeilingExceeded,
    LLMConfigError,
    LLMPermanentError,
    LLMRuntime,
    LLMSession,
    StructuredCallFailed,
)
from ..logging_config import get_logger

# Injected progress reporter: takes a validated JobProgress. In the worker this
# maps to BullMQ ``job.updateProgress``; in tests it collects the sequence.
ProgressReporter = Callable[[JobProgress], None]
# Raw PDF bytes → normalized parse (only the prospectus job uses it).
ParseFn = Callable[[bytes], Any]

E = TypeVar("E", bound=BaseModel)
T = TypeVar("T")

QUEUED = ("queued", "Queued")
PERSISTING = ("persisting-artifact", "Persisting artifact")
DONE = ("done", "Done")


def now() -> datetime:
    return datetime.now(timezone.utc)


def hour_bucket(at: datetime) -> str:
    """``asOf`` bucketed to the UTC hour (content-derived ids, ADR-0007 §2)."""
    return at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H")


def day_bucket(at: datetime) -> str:
    return at.astimezone(timezone.utc).strftime("%Y-%m-%d")


@dataclass(frozen=True)
class JobDeps:
    """Everything a job run may use; built once per worker.

    ``parse_fn=None`` ⇒ the prospectus job's default PyMuPDF parse.
    """

    artifact_store: ArtifactStore
    backend: BackendClient
    llm: LLMRuntime
    parse_fn: ParseFn | None = None
    heartbeat_seconds: float = 30.0


@dataclass(frozen=True)
class JobOutput:
    """What ``work()`` hands back: the artifact, where it goes, its headline."""

    artifact_key: str  # under the scoped artifacts prefix
    artifact: dict[str, Any]
    headline: str


class JobContext:
    """A run's view for ``work()``: deps, logger, ids and the progress cursor."""

    def __init__(
        self,
        *,
        name: str,
        job_id: str,
        deps: JobDeps,
        plan: Sequence[tuple[str, str]],
        report: ProgressReporter,
        log: Any,
    ) -> None:
        self.name = name
        self.job_id = job_id
        self.deps = deps
        self.log = log
        self.schema_version = JOBS[name].schema_version
        self._plan = plan
        self._report = report
        self._index = 0
        self._label = plan[0][1]
        self._lock = threading.Lock()

    # --- progress -------------------------------------------------------------

    def _event(self) -> JobProgress:
        phase = self._plan[self._index][0]
        return JobProgress(
            stepIndex=self._index,
            stepTotal=len(self._plan) - 1,
            phase=phase,
            label=self._label,
            at=now(),
        )

    def _emit(self, index: int, label: str | None = None) -> None:
        with self._lock:
            self._index = index
            self._label = label or self._plan[index][1]
            event = self._event()
        self._report(event)

    def advance(self, label: str | None = None) -> None:
        """Move to the next planned work step (``label`` overrides the default)."""
        if self._index + 1 >= len(self._plan) - 2:
            raise AssertionError(f"{self.name}: advanced past its planned work steps")
        self._emit(self._index + 1, label)

    @contextmanager
    def heartbeat(self) -> Iterator[None]:
        """Re-emit the current step every ``deps.heartbeat_seconds`` while a long
        blocking call runs, so subscribers see the job is alive. Same
        ``stepIndex``/``phase``, fresh ``at``."""
        stop = threading.Event()

        def beat() -> None:
            while not stop.wait(self.deps.heartbeat_seconds):
                with self._lock:
                    event = self._event()
                self._report(event)

        thread = threading.Thread(target=beat, name="progress-heartbeat", daemon=True)
        thread.start()
        try:
            yield
        finally:
            stop.set()
            thread.join(timeout=5)

    # --- dependencies -----------------------------------------------------------

    def llm_session(self) -> LLMSession:
        """A metered LLM session at this job kind's ceiling (no key ⇒ terminal)."""
        return self.deps.llm.session(self.name)

    def read(self, fetch: Callable[[], T], *, unknown: str) -> T:
        """A backend read where 404 means the anchor does not exist (terminal);
        5xx and network errors propagate for a BullMQ retry."""
        try:
            return fetch()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                raise TerminalJobError(
                    f"Unknown {unknown} (backend returned 404)"
                ) from exc
            raise


@dataclass(frozen=True)
class JobDefinition(Generic[E]):
    """One job family, declared next to its domain code.

    * ``envelope`` — the generated envelope model for this job name;
    * ``result_key(envelope)`` — the content-derived part of ``JobResult.jobId``
      after the registry prefix;
    * ``work_steps`` — ``(phase, default label)`` between ``queued`` and
      ``persisting-artifact``; one ``ctx.advance()`` per step;
    * ``work(envelope, ctx)`` — the job-specific code;
    * ``artifact_contract`` — the generated artifact model checked before the
      S3 write, or ``None`` for artifacts the contract does not register.

    Construction fails if the plan's phases disagree with the job registry.
    """

    name: str
    envelope: type[E]
    result_key: Callable[[E], str]
    work_steps: Sequence[tuple[str, str]]
    work: Callable[[E, JobContext], JobOutput]
    artifact_contract: type[BaseModel] | None = None

    def __post_init__(self) -> None:
        phases: list[str] = []
        for phase, _label in self.plan:
            if not phases or phases[-1] != phase:
                phases.append(phase)
        expected = list(JOBS[self.name].phases)
        if phases != expected:
            raise ValueError(
                f"{self.name}: progress plan phases {phases} != registry {expected}"
            )

    @property
    def plan(self) -> list[tuple[str, str]]:
        return [QUEUED, *self.work_steps, PERSISTING, DONE]


def run_job(
    definition: JobDefinition[Any],
    raw_envelope: dict,
    deps: JobDeps,
    report_progress: ProgressReporter,
) -> JobResult:
    """Run one job end to end and return a contract-valid ``JobResult``."""
    try:
        envelope = definition.envelope.model_validate(raw_envelope)
    except ValidationError as exc:
        raise TerminalJobError(f"Envelope failed contract validation: {exc}") from exc

    log = get_logger(__name__, correlation_id=str(envelope.correlationId))
    job_id = JOBS[definition.name].result_id_prefix + definition.result_key(envelope)
    log.info("job.start", extra={"jobId": job_id, "jobName": definition.name})

    plan = definition.plan
    ctx = JobContext(
        name=definition.name,
        job_id=job_id,
        deps=deps,
        plan=plan,
        report=report_progress,
        log=log,
    )
    ctx._emit(0)

    try:
        output = definition.work(envelope, ctx)
    except LLMConfigError as exc:
        raise TerminalJobError(str(exc)) from exc
    except LLMPermanentError as exc:
        raise TerminalJobError(f"LLM call failed permanently: {exc}") from exc
    except StructuredCallFailed as exc:
        raise TerminalJobError(
            f"LLM output was still invalid after the corrective retries: {exc}"
        ) from exc
    except CostCeilingExceeded as exc:
        raise TerminalJobError(f"Cost guard aborted the job: {exc}") from exc

    # ADR-0014 §3: strict pre-write validation against the generated contract
    # model. A malformed artifact is caught here, not in the browser, and
    # nothing is written to S3 on failure.
    if definition.artifact_contract is not None:
        try:
            definition.artifact_contract.model_validate(output.artifact)
        except ValidationError as exc:
            raise TerminalJobError(
                f"{definition.artifact_contract.__name__} failed contract "
                f"validation: {exc}"
            ) from exc

    pointer = deps.artifact_store.put_artifact(output.artifact_key, output.artifact)
    ctx._emit(len(plan) - 2)  # persisting-artifact
    cost = output.artifact.get("cost")
    log.info(
        "job.artifact_written",
        extra={
            "jobId": job_id,
            "bucket": pointer.bucket,
            "key": pointer.key,
            **({"costUsd": cost["estimatedCostUsd"]} if isinstance(cost, dict) else {}),
        },
    )

    result = JobResult(
        correlationId=envelope.correlationId,
        jobId=job_id,
        pointer=pointer,
        summary=SystemSummary(headline=output.headline, asOf=envelope.asOf),
        at=now(),
    )
    ctx._emit(len(plan) - 1)  # done
    log.info("job.done", extra={"jobId": job_id})
    return result
