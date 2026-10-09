"""Runtime conformance test (ADR-0011) for the generated Pydantic contract.

Loads the SAME golden fixtures the TS suite validates (packages/contracts/
fixtures) and parses each against the generated Pydantic v2 model. Cross-language
agreement on these fixtures is the guarantee the contract seam exists to provide.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from tuju_ai.contracts_generated import (
    AnnouncementSummaryJobEnvelope,
    FundamentalAnalysisArtifact,
    FundamentalJobEnvelope,
    JobFailure,
    JobProgress,
    JobResult,
    MarketBriefJobEnvelope,
    ProspectusArtifact,
    ProspectusJobEnvelope,
    TechnicalAnalysisArtifact,
    TechnicalJobEnvelope,
)

pytestmark = pytest.mark.unit

# services/ai/tests -> repo root -> packages/contracts/fixtures
FIXTURES_DIR = (
    Path(__file__).resolve().parents[3] / "packages" / "contracts" / "fixtures"
)


def _load(name: str) -> dict:
    return json.loads((FIXTURES_DIR / name).read_text(encoding="utf-8"))


@pytest.mark.parametrize(
    ("fixture", "model"),
    [
        ("technical-job-envelope.json", TechnicalJobEnvelope),
        ("fundamental-job-envelope.json", FundamentalJobEnvelope),
        ("market-brief-job-envelope.json", MarketBriefJobEnvelope),
        ("announcement-summary-job-envelope.json", AnnouncementSummaryJobEnvelope),
        ("prospectus-job-envelope.json", ProspectusJobEnvelope),
        ("job-progress.json", JobProgress),
        ("job-result.json", JobResult),
        ("job-result-system.json", JobResult),
        ("job-result-prospectus.json", JobResult),
        ("job-result-technical-system.json", JobResult),
        ("job-result-fundamental-system.json", JobResult),
        ("job-failure.json", JobFailure),
        ("prospectus-artifact.json", ProspectusArtifact),
        ("technical-analysis-artifact.json", TechnicalAnalysisArtifact),
        ("fundamental-analysis-artifact.json", FundamentalAnalysisArtifact),
    ],
)
def test_golden_fixture_conforms(fixture: str, model: type) -> None:
    """Each golden fixture parses cleanly against its generated Pydantic model."""
    model.model_validate(_load(fixture))


def test_contract_rejects_unknown_trigger() -> None:
    from pydantic import ValidationError

    bad = _load("technical-job-envelope.json")
    bad["trigger"] = "nope"
    with pytest.raises(ValidationError):
        TechnicalJobEnvelope.model_validate(bad)


def test_contract_accepts_system_trigger() -> None:
    good = _load("technical-job-envelope.json")
    good["trigger"] = "system"
    TechnicalJobEnvelope.model_validate(good)


def test_contract_rejects_out_of_enum_verdict() -> None:
    from pydantic import ValidationError

    bad = _load("job-result.json")
    bad["summary"]["verdict"] = "mega-bullish"
    with pytest.raises(ValidationError):
        JobResult.model_validate(bad)


def test_prospectus_result_fixture_is_verdictless() -> None:
    from pydantic import ValidationError

    good = _load("job-result-prospectus.json")
    assert set(good["summary"]) == {"headline", "asOf"}
    bad = _load("job-result-prospectus.json")
    bad["summary"]["source"] = "real"  # no provenance field on the wire summary
    with pytest.raises(ValidationError):
        JobResult.model_validate(bad)


def test_prospectus_envelope_requires_prospectus_id() -> None:
    from pydantic import ValidationError

    bad = _load("prospectus-job-envelope.json")
    bad["payload"] = {}
    with pytest.raises(ValidationError):
        ProspectusJobEnvelope.model_validate(bad)


def test_prospectus_artifact_rejects_missing_headline() -> None:
    from pydantic import ValidationError

    bad = _load("prospectus-artifact.json")
    del bad["headline"]
    with pytest.raises(ValidationError):
        ProspectusArtifact.model_validate(bad)


def test_prospectus_artifact_rejects_unknown_key() -> None:
    from pydantic import ValidationError

    bad = _load("prospectus-artifact.json")
    bad["extra"] = 1
    with pytest.raises(ValidationError):
        ProspectusArtifact.model_validate(bad)
