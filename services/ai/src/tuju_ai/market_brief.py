"""Daily market brief job (spec 06, ticket 02) — verdict-less ``SystemSummary``.

NO real LLM call yet (ADR-0003 scope guard): a deterministic narrative
template over the index levels fetched via the NestJS market-overview read API
(ADR-0004). MUST prominently flag the underlying series as
illustrative/synthetic (spec 06's demo-data honesty caveat) rather than
dressing fake numbers up as real market movement.
"""

from __future__ import annotations

from typing import Any, TypedDict

from .config import JOB_GENERATE_MARKET_BRIEF
from .contracts_generated import MarketBriefJobEnvelope
from .jobs.pipeline import JobContext, JobDefinition, JobOutput, day_bucket

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


def _work(envelope: MarketBriefJobEnvelope, ctx: JobContext) -> JobOutput:
    ctx.advance("Fetching index data")
    indices_response = ctx.deps.backend.get_market_indices()
    brief = compose_market_brief(indices_response.get("indices", []))
    ctx.advance()
    return JobOutput(
        artifact_key=f"brief/{day_bucket(envelope.asOf)}.json",
        artifact={
            "schemaVersion": ctx.schema_version,
            "headline": brief["headline"],
            "lines": brief["lines"],
            "illustrative": brief["illustrative"],
        },
        headline=brief["headline"],
    )


# No symbol/timeframe anchor: the content-derived jobId is keyed by date
# (ADR-0007 §2), so re-enqueuing the same day collapses to the existing job.
MARKET_BRIEF_JOB = JobDefinition(
    name=JOB_GENERATE_MARKET_BRIEF,
    envelope=MarketBriefJobEnvelope,
    result_key=lambda e: day_bucket(e.asOf),
    work_steps=[
        ("fetching-market-data", "Fetching index data"),
        ("drafting-narrative", "Drafting market brief"),
    ],
    work=_work,
)
