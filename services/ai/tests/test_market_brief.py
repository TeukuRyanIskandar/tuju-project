"""Unit tests for the deterministic market-brief narrative (spec 06, ticket 02)."""

from __future__ import annotations

import pytest

from tuju_ai.market_brief import ILLUSTRATIVE_NOTE, compose_market_brief

pytestmark = pytest.mark.unit


def test_headline_narrates_the_headline_index_direction() -> None:
    brief = compose_market_brief(
        [
            {
                "id": "idx-1",
                "kind": "headline",
                "name": "FBM KLCI (demo)",
                "sectorName": None,
                "level": "1500.00",
                "pctChange": 1.23,
                "provenance": "synthetic",
            }
        ]
    )
    assert "FBM KLCI (demo)" in brief["headline"]
    assert "higher" in brief["headline"]
    assert "+1.23%" in brief["headline"]


def test_negative_change_narrates_lower() -> None:
    brief = compose_market_brief(
        [
            {
                "id": "idx-1",
                "kind": "headline",
                "name": "FBM KLCI (demo)",
                "sectorName": None,
                "level": "1480.00",
                "pctChange": -0.5,
                "provenance": "synthetic",
            }
        ]
    )
    assert "lower" in brief["headline"]


def test_always_flags_illustrative_data() -> None:
    brief = compose_market_brief([])
    assert brief["illustrative"] is True
    assert ILLUSTRATIVE_NOTE in brief["lines"]


def test_empty_indices_yields_a_graceful_fallback_headline() -> None:
    brief = compose_market_brief([])
    assert brief["headline"]
    assert brief["lines"][0] == brief["headline"]


def test_top_sector_moves_are_included_ranked_by_magnitude() -> None:
    brief = compose_market_brief(
        [
            {
                "id": "idx-headline",
                "kind": "headline",
                "name": "FBM KLCI (demo)",
                "sectorName": None,
                "level": "1500.00",
                "pctChange": 0.1,
                "provenance": "synthetic",
            },
            {
                "id": "idx-small",
                "kind": "sector",
                "name": "Small Sector",
                "sectorName": "Small",
                "level": "100.00",
                "pctChange": 0.2,
                "provenance": "synthetic",
            },
            {
                "id": "idx-big",
                "kind": "sector",
                "name": "Big Sector",
                "sectorName": "Big",
                "level": "200.00",
                "pctChange": -3.5,
                "provenance": "synthetic",
            },
        ]
    )
    # The bigger absolute move (Big, -3.5%) is narrated before the smaller one.
    big_idx = next(i for i, line in enumerate(brief["lines"]) if "Big" in line)
    small_idx = next(i for i, line in enumerate(brief["lines"]) if "Small" in line)
    assert big_idx < small_idx


def test_sectors_with_no_pct_change_are_skipped() -> None:
    brief = compose_market_brief(
        [
            {
                "id": "idx-sector",
                "kind": "sector",
                "name": "No Data Sector",
                "sectorName": "No Data",
                "level": "100.00",
                "pctChange": None,
                "provenance": "synthetic",
            }
        ]
    )
    assert not any("No Data" in line for line in brief["lines"])
