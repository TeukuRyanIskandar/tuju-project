"""Conformance test for the generated job registry (architecture-deepening ticket 07).

``contracts_generated/job_registry.py`` is generated from the same Zod source as
the Pydantic models. This pins that the two generated outputs agree: each job's
phases are wire-valid ``JobProgress.phase`` values, its schema version is a
known one, and the artifacts that carry a ``jobName``/``schemaVersion`` literal
agree with their registry entry. (``JobName`` itself is not emitted into
``models.py``; the TS suite pins that every ``JobName`` has an entry.)
"""

from __future__ import annotations

from typing import get_args

import pytest

from tuju_ai import config
from tuju_ai.contracts_generated import (
    SCHEMA_VERSIONS,
    FundamentalAnalysisArtifact,
    JobProgress,
    ProspectusArtifact,
    TechnicalAnalysisArtifact,
)
from tuju_ai.contracts_generated.job_registry import JOBS, QUEUE_ANALYSIS

pytestmark = pytest.mark.unit

# Artifacts whose generated model pins the job name as a Literal.
ARTIFACTS_WITH_JOB_NAME = (TechnicalAnalysisArtifact, FundamentalAnalysisArtifact)


def _literal_values(model, field: str) -> set[str]:
    return set(get_args(model.model_fields[field].annotation))


def test_registry_names_the_five_jobs_config_reexports() -> None:
    assert set(JOBS) == {
        config.JOB_ANALYZE_TECHNICAL,
        config.JOB_ANALYZE_FUNDAMENTAL,
        config.JOB_GENERATE_MARKET_BRIEF,
        config.JOB_SUMMARIZE_ANNOUNCEMENT,
        config.JOB_ANALYZE_PROSPECTUS,
    }


@pytest.mark.parametrize("artifact", ARTIFACTS_WITH_JOB_NAME, ids=lambda m: m.__name__)
def test_artifact_job_name_and_schema_version_match_registry(artifact) -> None:
    (name,) = _literal_values(artifact, "jobName")
    assert _literal_values(artifact, "schemaVersion") == {JOBS[name].schema_version}


def test_prospectus_artifact_schema_version_matches_registry() -> None:
    assert _literal_values(ProspectusArtifact, "schemaVersion") == {
        JOBS[config.JOB_ANALYZE_PROSPECTUS].schema_version
    }


@pytest.mark.parametrize("name", sorted(JOBS))
def test_spec_conforms_to_generated_models(name: str) -> None:
    spec = JOBS[name]
    assert spec.name == name
    assert spec.queue == QUEUE_ANALYSIS == "analysis"
    # ADR-0007 §4: fixed, ordered phases, each a wire-valid JobProgress.phase.
    assert spec.phases[0] == "queued" and spec.phases[-1] == "done"
    assert len(set(spec.phases)) == len(spec.phases)
    assert set(spec.phases) <= _literal_values(JobProgress, "phase")
    # Colon-form JobResult.jobId prefix (ADR-0007 §2), never the BullMQ form.
    assert spec.result_id_prefix.endswith(":")
    assert spec.schema_version in SCHEMA_VERSIONS.values()


def test_registry_phases_union_is_the_progress_phase_enum() -> None:
    union = {p for spec in JOBS.values() for p in spec.phases}
    assert union == _literal_values(JobProgress, "phase")


def test_config_reexports_derive_from_the_registry() -> None:
    assert config.QUEUE_ANALYSIS == QUEUE_ANALYSIS
    assert config.TECHNICAL_JOB_RESULT_PREFIX == "technical:"
    assert config.FUNDAMENTAL_JOB_RESULT_PREFIX == "fundamental:"
    assert config.MARKET_BRIEF_JOB_ID_PREFIX == "brief:"
    assert config.ANNOUNCEMENT_SUMMARY_JOB_ID_PREFIX == "ann:"
    assert config.PROSPECTUS_JOB_ID_PREFIX == "prospectus:"
