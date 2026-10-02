"""Unit tests for the deterministic announcement summary (spec 06, ticket 03)."""

from __future__ import annotations

import pytest

from tuju_ai.announcement_summary import compose_announcement_summary

pytestmark = pytest.mark.unit


def test_financial_results_announcement() -> None:
    summary = compose_announcement_summary(
        {
            "companyName": "Malayan Banking Berhad",
            "category": "FINANCIAL_RESULTS",
            "title": "Q3 FY2026 Financial Results",
        }
    )
    assert summary["headline"] == (
        "Malayan Banking Berhad filed its financial results: "
        "Q3 FY2026 Financial Results"
    )
    assert summary["category"] == "FINANCIAL_RESULTS"
    assert summary["sourceTitle"] == "Q3 FY2026 Financial Results"


def test_shareholding_change_announcement() -> None:
    summary = compose_announcement_summary(
        {
            "companyName": "Example Bhd",
            "category": "SHAREHOLDING_CHANGE",
            "title": "Change in substantial shareholder's interest",
        }
    )
    assert "disclosed a shareholding change" in summary["headline"]


def test_unknown_category_falls_back_to_generic_verb() -> None:
    summary = compose_announcement_summary(
        {
            "companyName": "Example Bhd",
            "category": "SOMETHING_NEW",
            "title": "A disclosure",
        }
    )
    assert "filed a disclosure" in summary["headline"]
    assert summary["category"] == "SOMETHING_NEW"


def test_missing_fields_do_not_crash() -> None:
    summary = compose_announcement_summary({})
    assert summary["headline"]
    assert summary["category"] == "GENERAL"
