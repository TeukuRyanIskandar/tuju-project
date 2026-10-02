"""Daily market brief narrative (spec 06, ticket 02).

NO real LLM call yet — same "no real analysis logic" scaffold posture as
graph.py (ADR-0003 scope guard). A deterministic narrative template over the
fetched index levels. MUST prominently flag the underlying series as
illustrative/synthetic (spec 06's demo-data honesty caveat) rather than
dressing fake numbers up as real market movement.
"""

from __future__ import annotations

from typing import Any, TypedDict

ILLUSTRATIVE_NOTE = (
    "This brief narrates illustrative, synthetic price data generated for "
    "demo purposes — not a real market reading."
)


class MarketBrief(TypedDict):
    headline: str
    lines: list[str]
    illustrative: bool


def compose_market_brief(indices: list[dict[str, Any]]) -> MarketBrief:
    """Build the brief from a `GET /market/indices` response's `indices` list."""
    headline_index = next(
        (i for i in indices if i.get("kind") == "headline"), None
    )
    sector_moves = [
        i
        for i in indices
        if i.get("kind") == "sector" and i.get("pctChange") is not None
    ]
    # Largest absolute moves first — the "what moved today" read.
    sector_moves.sort(key=lambda i: abs(i["pctChange"]), reverse=True)

    if headline_index is not None and headline_index.get("pctChange") is not None:
        pct = headline_index["pctChange"]
        direction = "higher" if pct >= 0 else "lower"
        headline = (
            f"{headline_index['name']} closed {direction} ({pct:+.2f}%) "
            "on illustrative data."
        )
    else:
        headline = "No illustrative index data is available yet for today's brief."

    lines = [headline, ILLUSTRATIVE_NOTE]
    for sector in sector_moves[:3]:
        lines.append(
            f"{sector['sectorName']} sector moved {sector['pctChange']:+.2f}% "
            "(illustrative)."
        )

    return {"headline": headline, "lines": lines, "illustrative": True}
