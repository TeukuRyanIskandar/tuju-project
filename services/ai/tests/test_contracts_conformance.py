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
    FundamentalJobEnvelope,
    JobFailure,
    JobProgress,
    JobResult,
    TechnicalJobEnvelope,
)

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
        ("job-progress.json", JobProgress),
        ("job-result.json", JobResult),
        ("job-failure.json", JobFailure),
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


def test_contract_rejects_out_of_enum_verdict() -> None:
    from pydantic import ValidationError

    bad = _load("job-result.json")
    bad["summary"]["verdict"] = "mega-bullish"
    with pytest.raises(ValidationError):
        JobResult.model_validate(bad)
