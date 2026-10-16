"""Job pipeline invariants (architecture-deepening ticket 02).

Tested ONCE against a trivial definition, not per job family: envelope
validation, registry-derived jobId and progress phases, the contract pre-write
check, the claim-check, the verdict-less ``JobResult`` and the ADR-0007 §6
error mapping.
"""

from __future__ import annotations

import hashlib
import time
from copy import deepcopy
from datetime import datetime
from typing import Callable

import httpx
import pytest
from pydantic import BaseModel, ConfigDict, Field

from job_helpers import BUCKET, deps, load
from tuju_ai.config import JOB_GENERATE_MARKET_BRIEF
from tuju_ai.contracts_generated import (
    JobProgress,
    JobResult,
    MarketBriefJobEnvelope,
)
from tuju_ai.contracts_generated.job_registry import JOBS
from tuju_ai.errors import TerminalJobError
from tuju_ai.handler import DEFINITIONS, handle_job
from tuju_ai.jobs.pipeline import (
    JobContext,
    JobDefinition,
    JobOutput,
    run_job,
)
from tuju_ai.llm import (
    CostCeilingExceeded,
    LLMConfigError,
    LLMPermanentError,
    LLMTransientError,
    MalformedModelOutput,
    OutputRejected,
)

pytestmark = pytest.mark.unit

NAME = JOB_GENERATE_MARKET_BRIEF  # any registered name; its phases drive the plan
ENVELOPE = "market-brief-job-envelope.json"


class StrictArtifact(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schemaVersion: str
    headline: str


Work = Callable[[MarketBriefJobEnvelope, JobContext], JobOutput]


def _ok_work(envelope: MarketBriefJobEnvelope, ctx: JobContext) -> JobOutput:
    ctx.advance("Custom fetch label")
    ctx.advance()
    return JobOutput(
        artifact_key="trivial/one.json",
        artifact={"schemaVersion": ctx.schema_version, "headline": "Trivial headline"},
        headline="Trivial headline",
    )


def _definition(work: Work = _ok_work, contract=StrictArtifact) -> JobDefinition:
    return JobDefinition(
        name=NAME,
        envelope=MarketBriefJobEnvelope,
        result_key=lambda e: "trivial-key",
        work_steps=[
            ("fetching-market-data", "Fetching"),
            ("drafting-narrative", "Drafting"),
        ],
        work=work,
        artifact_contract=contract,
    )


def _run(definition: JobDefinition, envelope: dict | None = None, **deps_kw):
    job_deps, s3 = deps(**deps_kw)
    progress: list[JobProgress] = []
    result = run_job(definition, envelope or load(ENVELOPE), job_deps, progress.append)
    return result, progress, s3


def _raising(exc: Exception) -> Work:
    def work(envelope, ctx):
        raise exc

    return work


# --- the happy path ---------------------------------------------------------------


def test_result_is_registry_keyed_verdictless_and_points_at_the_written_artifact() -> None:
    result, _progress, s3 = _run(_definition())

    JobResult.model_validate(result.model_dump(mode="json"))
    assert result.jobId == JOBS[NAME].result_id_prefix + "trivial-key"
    summary = result.model_dump(mode="json")["summary"]
    assert set(summary) == {"headline", "asOf"}
    assert summary["headline"] == "Trivial headline"

    key = "analysis/trivial/one.json"
    assert result.pointer.bucket == BUCKET and result.pointer.key == key
    body = s3.objects[(BUCKET, key)]
    assert hashlib.sha256(body).hexdigest() == result.pointer.sha256
    assert s3.artifact(key)["schemaVersion"] == JOBS[NAME].schema_version


def test_progress_follows_the_registry_phases() -> None:
    _result, progress, _s3 = _run(_definition())

    assert [p.stepIndex for p in progress] == [0, 1, 2, 3, 4]
    assert [p.phase for p in progress] == list(JOBS[NAME].phases)
    assert {p.stepTotal for p in progress} == {4}  # index of `done`
    assert [p.label for p in progress] == [
        "Queued", "Custom fetch label", "Drafting", "Persisting artifact", "Done",
    ]
    for p in progress:
        JobProgress.model_validate(p.model_dump(mode="json"))


def test_every_registered_job_has_a_definition() -> None:
    # Each definition's plan is checked against JOBS[name].phases when built.
    assert set(DEFINITIONS) == set(JOBS)


def test_a_plan_disagreeing_with_the_registry_is_rejected() -> None:
    with pytest.raises(ValueError, match="registry"):
        JobDefinition(
            name=NAME,
            envelope=MarketBriefJobEnvelope,
            result_key=lambda e: "k",
            work_steps=[("drafting-narrative", "Drafting")],  # missing a phase
            work=_ok_work,
        )


def test_advancing_past_the_plan_is_a_bug() -> None:
    def greedy(envelope, ctx):
        for _ in range(3):
            ctx.advance()
        raise AssertionError("unreachable")

    with pytest.raises(AssertionError, match="past its planned work steps"):
        _run(_definition(greedy))


def test_heartbeat_reemits_the_current_step() -> None:
    def slow(envelope, ctx):
        ctx.advance()
        with ctx.heartbeat():
            time.sleep(0.35)
        ctx.advance()
        return JobOutput(
            artifact_key="trivial/one.json",
            artifact={"schemaVersion": ctx.schema_version, "headline": "h"},
            headline="h",
        )

    _result, progress, _s3 = _run(_definition(slow), heartbeat_seconds=0.1)
    fetching = [p for p in progress if p.phase == "fetching-market-data"]
    assert len(fetching) >= 3  # the step itself + >= 2 heartbeats
    assert {p.stepIndex for p in fetching} == {1}


# --- terminal paths ----------------------------------------------------------------


def test_bad_envelope_is_terminal_before_any_work() -> None:
    bad = load(ENVELOPE)
    bad["trigger"] = "not-a-trigger"
    called: list[bool] = []
    with pytest.raises(TerminalJobError, match="Envelope failed contract validation"):
        _run(_definition(lambda e, c: called.append(True)), bad)  # type: ignore[arg-type]
    assert called == []


def test_unknown_job_name_is_terminal() -> None:
    job_deps, _s3 = deps()
    with pytest.raises(TerminalJobError, match="Unknown job name"):
        handle_job("analyze-nonsense", load(ENVELOPE), deps=job_deps, report_progress=print)


def test_contract_violation_is_terminal_and_writes_nothing() -> None:
    def drifted(envelope, ctx):
        return JobOutput(
            artifact_key="trivial/one.json",
            artifact={"schemaVersion": "x", "headline": "h", "surprise": True},
            headline="h",
        )

    job_deps, s3 = deps()
    progress: list[JobProgress] = []
    with pytest.raises(TerminalJobError, match="StrictArtifact failed contract validation"):
        run_job(_definition(drifted), load(ENVELOPE), job_deps, progress.append)
    assert s3.calls == []
    assert "persisting-artifact" not in [p.phase for p in progress]


def test_no_contract_means_no_pre_write_check() -> None:
    at = datetime.fromisoformat("2026-10-08T18:02:03.123456+08:00")
    artifact = {"anything": 1, "at": at, "explicitNull": None}

    def loose(envelope, ctx):
        return JobOutput(artifact_key="t.json", artifact=artifact, headline="h")

    result, _p, s3 = _run(_definition(loose, contract=None))
    assert s3.artifact("analysis/t.json") == {
        "anything": 1, "at": str(at), "explicitNull": None,
    }
    assert artifact["at"] is at
    assert result.summary.headline == "h"


def test_contract_serialization_uses_aliases_omits_unset_and_keeps_explicit_nulls() -> None:
    class Nested(BaseModel):
        timestamp: datetime = Field(alias="generatedAt")
        omitted: str | None = None
        explicit_null: str | None = Field(default=None, alias="explicitNull")

    class WireArtifact(BaseModel):
        nested: Nested = Field(alias="provenance")
        omitted_default: int = Field(default=42, alias="omittedDefault")

    artifact = {"provenance": {
        "generatedAt": datetime.fromisoformat("2026-10-08T18:02:03.123456+08:00"),
        "explicitNull": None,
    }}
    before = deepcopy(artifact)

    def work(envelope, ctx):
        return JobOutput(artifact_key="wire.json", artifact=artifact, headline="h")

    _result, _p, s3 = _run(_definition(work, contract=WireArtifact))
    assert s3.artifact("analysis/wire.json") == {"provenance": {
        "generatedAt": "2026-10-08T18:02:03.123456+08:00", "explicitNull": None,
    }}
    assert artifact == before
    assert isinstance(artifact["provenance"]["generatedAt"], datetime)


@pytest.mark.parametrize(
    ("exc", "match"),
    [
        (LLMConfigError("OPENROUTER_API_KEY is not configured"), "OPENROUTER_API_KEY"),
        (LLMPermanentError("401 bad key"), "failed permanently: 401"),
        (MalformedModelOutput("step 'narrate': no JSON"), "still invalid.*narrate"),
        (OutputRejected("step 'narrate': banned term"), "still invalid.*banned"),
        (CostCeilingExceeded("over $2"), "Cost guard aborted"),
    ],
)
def test_llm_failures_map_to_terminal(exc: Exception, match: str) -> None:
    job_deps, s3 = deps()
    with pytest.raises(TerminalJobError, match=match):
        run_job(_definition(_raising(exc)), load(ENVELOPE), job_deps, lambda _p: None)
    assert s3.calls == []


@pytest.mark.parametrize(
    "exc", [LLMTransientError("429"), RuntimeError("blip"), ConnectionError("reset")]
)
def test_other_failures_propagate_for_a_bullmq_retry(exc: Exception) -> None:
    with pytest.raises(type(exc)):
        _run(_definition(_raising(exc)))


def test_missing_llm_key_fails_the_session_terminally() -> None:
    def wants_llm(envelope, ctx):
        ctx.llm_session()
        raise AssertionError("unreachable")

    from tuju_ai.config import JOB_ANALYZE_TECHNICAL

    definition = JobDefinition(
        name=JOB_ANALYZE_TECHNICAL,
        envelope=MarketBriefJobEnvelope,  # any envelope; the work never gets far
        result_key=lambda e: "k",
        work_steps=[
            ("fetching-market-data", "a"),
            ("computing-indicators", "b"),
            ("synthesizing-verdict", "c"),
        ],
        work=wants_llm,
    )
    with pytest.raises(TerminalJobError, match="OPENROUTER_API_KEY.*analyze-technical"):
        _run(definition, llm=None)


# --- backend reads ------------------------------------------------------------------


def _status_error(code: int) -> httpx.HTTPStatusError:
    req = httpx.Request("GET", "http://backend/x")
    return httpx.HTTPStatusError("x", request=req, response=httpx.Response(code, request=req))


def test_a_404_read_is_terminal_and_names_the_anchor() -> None:
    def reads(envelope, ctx):
        ctx.read(lambda: (_ for _ in ()).throw(_status_error(404)), unknown="thing 'x'")

    with pytest.raises(TerminalJobError, match=r"Unknown thing 'x' \(backend returned 404\)"):
        _run(_definition(reads))


def test_a_5xx_read_propagates_for_a_retry() -> None:
    def reads(envelope, ctx):
        ctx.read(lambda: (_ for _ in ()).throw(_status_error(503)), unknown="thing")

    with pytest.raises(httpx.HTTPStatusError):
        _run(_definition(reads))
