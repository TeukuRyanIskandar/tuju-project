"""Deterministic ``FakeLLMClient`` for unit tests / CI (ticket 05).

NEVER touches the network. Recognises the analysis step from the ``[step:<id>]``
marker the prompts carry and returns canned, schema-valid JSON. The what-to-watch
reduce is derived from the section outputs embedded in its prompt, so tests can
prove the reduce really consumed the other four sections.

Knobs for failure-mode tests:

* ``garbage_first``: ``{step: n}`` — the first ``n`` calls for ``step`` return
  non-JSON text (exercises the one-bounded-retry path).
* ``usage``: fixed :class:`Usage` returned for every call (exercises the cost
  guard with huge/cheap token counts); default usage is derived from text size.
"""

from __future__ import annotations

import hashlib
import json
import re

from .base import LLMResponse, Message, Usage

_STEP_RE = re.compile(r"\[step:([a-z\-]+)\]")

_CANNED: dict[str, dict] = {
    "offer": {
        "summary": "Public issue plus offer for sale to fund expansion.",
        "totalShares": "150,000,000 shares",
        "publicIssueShares": "120,000,000 new shares",
        "offerForSaleShares": "30,000,000 existing shares",
        "priceRange": "RM0.50 per share",
        "marketCapAtIpo": "RM300 million",
        "grossProceeds": "RM60 million",
        "useOfProceeds": [
            {
                "purpose": "Capacity expansion",
                "amount": "RM35 million",
                "percentOfProceeds": "58%",
            },
            {
                "purpose": "Working capital",
                "amount": "RM15 million",
                "percentOfProceeds": "25%",
            },
            {
                "purpose": "Listing expenses",
                "amount": "RM10 million",
                "percentOfProceeds": "17%",
            },
        ],
    },
    "business": {
        "lines": [
            "Manufactures and supplies industrial components in Malaysia.",
            "Sells mainly to a small set of multinational customers.",
            "Plans to add a new plant funded by the IPO proceeds.",
        ]
    },
    "financials": {
        "currency": "RM",
        "periods": [
            {"period": "FY2022", "revenue": "100m", "profitAfterTax": "8m"},
            {"period": "FY2023", "revenue": "120m", "profitAfterTax": "11m"},
            {"period": "FY2024", "revenue": "150m", "profitAfterTax": "16m"},
        ],
        "trend": "Revenue and profit grew every year over the three-year track record.",
        "highlights": ["Revenue CAGR of about 22%", "Margins widened as scale grew"],
    },
    "risk-factors": {
        "summary": "Customer concentration and execution risk dominate.",
        "themes": [
            {
                "rank": 1,
                "theme": "Customer concentration",
                "severity": "high",
                "summary": "A few customers account for most revenue.",
            },
            {
                "rank": 2,
                "theme": "Expansion execution",
                "severity": "medium",
                "summary": "The new plant may be delayed or over budget.",
            },
            {
                "rank": 3,
                "theme": "Foreign exchange",
                "severity": "low",
                "summary": "Part of revenue and costs is in foreign currency.",
            },
        ],
    },
    "cornerstone-investors": {
        "present": True,
        "investors": [
            {
                "name": "Example Cornerstone Fund A",
                "allocation": "20,000,000 shares",
                "notes": None,
            },
            {
                "name": "Example Cornerstone Fund B",
                "allocation": "10,000,000 shares",
                "notes": "Six-month lock-up",
            },
        ],
        "summary": "Two cornerstone investors take up part of the offering.",
    },
    "narrate": {"narrative": "Fake: price above all SMAs with RSI at mid-band."},
}



class FakeLLMClient:
    """Scriptable, deterministic ``LLMClient``. Records every call."""

    def __init__(
        self,
        *,
        model: str = "fake/deterministic",
        garbage_first: dict[str, int] | None = None,
        usage: Usage | None = None,
    ) -> None:
        self.model = model
        self.calls: list[list[Message]] = []
        self.steps: list[str] = []
        self._garbage_left = dict(garbage_first or {})
        self._fixed_usage = usage
        self._seen_prefixes: set[str] = set()

    def _step_of(self, messages: list[Message]) -> str:
        for m in reversed(messages):
            found = _STEP_RE.search(m.content)
            if found:
                return found.group(1)
        raise AssertionError("FakeLLMClient: no [step:<id>] marker in prompt")

    def _watch(self, messages: list[Message]) -> dict:
        marker = "SECTION_OUTPUTS:\n"
        holder = next((m.content for m in messages if marker in m.content), None)
        assert holder is not None, "reduce prompt must embed SECTION_OUTPUTS"
        outputs, _ = json.JSONDecoder().raw_decode(
            holder[holder.index(marker) + len(marker) :]
        )
        risks = (outputs.get("riskFactors") or {}).get("themes") or []
        top_risk = risks[0]["theme"] if risks else "key risks"
        proceeds = (outputs.get("offer") or {}).get("useOfProceeds") or []
        top_use = proceeds[0]["purpose"] if proceeds else "use of proceeds"
        trend = (outputs.get("financials") or {}).get("trend") or ""
        business = ((outputs.get("business") or {}).get("lines") or [""])[0]
        return {
            "headline": f"Watch {top_risk.lower()} and how {top_use.lower()} is delivered",
            "items": [
                {"point": top_risk, "why": "Highest-ranked risk theme", "sourceSection": "risk-factors"},
                {"point": top_use, "why": "Largest planned use of proceeds", "sourceSection": "offer"},
                {"point": trend[:60], "why": "Track-record trend", "sourceSection": "financials"},
                {"point": business[:60], "why": "Core business", "sourceSection": "business"},
            ],
        }

    def complete(
        self,
        messages: list[Message],
        *,
        json_mode: bool = True,
        max_tokens: int | None = None,
    ) -> LLMResponse:
        self.calls.append(list(messages))
        step = self._step_of(messages)
        self.steps.append(step)

        if self._garbage_left.get(step, 0) > 0:
            self._garbage_left[step] -= 1
            text = "Sure! here is the analysis (no JSON, sorry)"
        elif step == "what-to-watch":
            text = json.dumps(self._watch(messages))
        else:
            text = json.dumps(_CANNED[step])

        prompt_chars = sum(len(m.content) for m in messages)
        cached = 0
        for m in messages:
            if m.cache:
                digest = hashlib.sha256(m.content.encode()).hexdigest()
                if digest in self._seen_prefixes:
                    cached += len(m.content) // 4
                self._seen_prefixes.add(digest)
        usage = self._fixed_usage or Usage(
            prompt_tokens=prompt_chars // 4,
            completion_tokens=len(text) // 4,
            cached_tokens=cached,
        )
        return LLMResponse(text=text, usage=usage, model=self.model)
