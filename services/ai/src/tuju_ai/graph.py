"""Trivial LangGraph graph stub (ADR-0003 scope guard).

NO real TA/FA logic — indicator/metric computation is a later feature effort and
is explicitly out of scope for the scaffold (ADR-0007 "Out of scope"). This graph
exists only to prove the wiring: a linear 3-node graph that produces a placeholder
verdict, headline, and artifact body the worker will claim-check to S3.

The internal artifact JSON is opaque to the wire contract (ADR-0004/0007); its
shape may evolve freely without touching packages/contracts.
"""

from __future__ import annotations

from typing import Any, Literal, TypedDict

from langgraph.graph import END, START, StateGraph

from .contracts_generated import SCHEMA_VERSIONS

JobKind = Literal["technical", "fundamental"]

# Placeholder verdicts, one per job family, valid against the contract Verdict enum.
_STUB_VERDICT: dict[JobKind, str] = {
    "technical": "neutral",
    "fundamental": "fairly-valued",
}


class AnalysisState(TypedDict, total=False):
    """State threaded through the stub graph."""

    kind: JobKind
    symbol: str
    verdict: str
    headline: str
    artifact: dict[str, Any]


def _resolve_inputs(state: AnalysisState) -> AnalysisState:
    """Node 1 — echo inputs (stands in for future data fetching)."""
    return {"symbol": state["symbol"], "kind": state["kind"]}


def _synthesize_verdict(state: AnalysisState) -> AnalysisState:
    """Node 2 — assign a fixed placeholder verdict (no real analysis)."""
    return {"verdict": _STUB_VERDICT[state["kind"]]}


def _draft_artifact(state: AnalysisState) -> AnalysisState:
     """Node 3 — assemble the (opaque) placeholder artifact + thin headline."""
     kind = state["kind"]
     symbol = state["symbol"]
     return {
         "headline": f"Placeholder {kind} analysis for {symbol} (scaffold — no real logic)",
         "artifact": {
             "schemaVersion": SCHEMA_VERSIONS['stub'],
             "kind": kind,
             "symbol": symbol,
             "verdict": state["verdict"],
             "note": "Scaffold artifact. Real TA/FA content is a later feature effort.",
         },
     }


def build_analysis_graph():
    """Compile the linear stub graph: resolve → verdict → artifact."""
    graph = StateGraph(AnalysisState)
    graph.add_node("resolve_inputs", _resolve_inputs)
    graph.add_node("synthesize_verdict", _synthesize_verdict)
    graph.add_node("draft_artifact", _draft_artifact)
    graph.add_edge(START, "resolve_inputs")
    graph.add_edge("resolve_inputs", "synthesize_verdict")
    graph.add_edge("synthesize_verdict", "draft_artifact")
    graph.add_edge("draft_artifact", END)
    return graph.compile()


def run_analysis(kind: JobKind, symbol: str) -> AnalysisState:
    """Convenience: invoke the compiled stub graph and return its final state."""
    return build_analysis_graph().invoke({"kind": kind, "symbol": symbol})
