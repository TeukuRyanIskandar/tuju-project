"""Narrative post-checks, used as :func:`~tuju_ai.llm.structured.ask` validators.

poc-phase-a-worker ticket 04: a narrative may only use numbers present in the
fact payload, and must not read as investment advice.

* :func:`ungrounded_number` — raw string containment: every numeral in the text
  (``70%``, ``RM1.23``, ``0.85``; commas/spaces stripped, also checked by its
  integer part) must appear among the numbers of the given sources. A source
  metric declared ``scale: "fraction"`` also contributes its whole-unit
  rendering, so a percentage metric can be narrated honestly.
* :func:`advice_term` — case-insensitive substring scan for :data:`BAN_WORDS`.

Both return a rejection reason (fed back to the model on the corrective retry)
or ``None``.
"""

from __future__ import annotations

import re
from typing import Any

BAN_WORDS = {
    "buy",
    "sell",
    "hold",
    "target",
    "price target",
    "undervalued",
    "overvalued",
    "underweight",
    "overweight",
    "recommendation",
    "recommend",
    "advise",
    "should invest",
    "should buy",
}

NUMBER_REGEX = re.compile(r"(?:RM)?[\d,]+\.?\d*\s*%?|[\d.]+%|[\d,]+(?:\.\d+)?")


def _text_numbers(text: str) -> set[str]:
    numbers: set[str] = set()
    for m in NUMBER_REGEX.findall(text):
        normalized = m.replace(",", "").replace(" ", "").strip()
        if normalized.endswith("%"):
            normalized = normalized[:-1]
        numbers.add(normalized)
        if "." in normalized:
            numbers.add(normalized.split(".")[0])
    return numbers


def _source_numbers(source: Any) -> set[str]:
    numbers: set[str] = set()

    def add(value: int | float) -> None:
        s = str(value)
        numbers.add(s)
        if "." in s:
            numbers.add(s.split(".")[0])

    def visit(obj: Any) -> None:
        if isinstance(obj, dict):
            for v in obj.values():
                visit(v)
            # A `fraction` metric is stored as a fraction of its unit, so the
            # multiplied value is its honest rendering. Without this the check
            # rejects a correct 5.67% for a 0.045 dividend yield while accepting
            # the wrong "0.045%" — the narrative is then pushed toward saying
            # something false in order to stay grounded. Scaled to the same 4
            # fraction digits the headline uses, so float noise is not accepted
            # in place of the real number.
            if obj.get("scale") == "fraction":
                raw = obj.get("value")
                if isinstance(raw, (int, float)) and not isinstance(raw, bool):
                    add(round(raw * 100, 4))
        elif isinstance(obj, (list, tuple)):
            for item in obj:
                visit(item)
        elif isinstance(obj, (int, float)) and not isinstance(obj, bool):
            add(obj)

    visit(source)
    return numbers


def ungrounded_number(text: str, *sources: Any) -> str | None:
    """The first numeral in ``text`` not found in ``sources``, as a reason."""
    known: set[str] = set()
    for source in sources:
        known |= _source_numbers(source)
    for num in sorted(_text_numbers(text)):
        if num and num not in known:
            return f"number {num!r} is not in the facts; use ONLY numbers from the data"
    return None


def advice_term(text: str) -> str | None:
    """The first banned (advice-shaped) term in ``text``, as a reason."""
    lower = text.lower()
    for banned in sorted(BAN_WORDS):
        if banned in lower:
            return f"banned term {banned!r}; describe the data, never give investment advice"
    return None
