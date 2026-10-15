"""Narrative post-checks, used as :func:`~tuju_ai.llm.structured.ask` validators.

poc-phase-a-worker ticket 04: a narrative may only use numbers present in the
fact payload, and must not read as investment advice.

* :func:`ungrounded_number` — raw string containment: every numeral in the text
  (``70%``, ``RM1.23``, ``0.85``; commas/spaces stripped, also checked by its
  integer part) must appear among the numbers of the given sources.
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

    def visit(obj: Any) -> None:
        if isinstance(obj, dict):
            for v in obj.values():
                visit(v)
        elif isinstance(obj, (list, tuple)):
            for item in obj:
                visit(item)
        elif isinstance(obj, (int, float)) and not isinstance(obj, bool):
            s = str(obj)
            numbers.add(s)
            if "." in s:
                numbers.add(s.split(".")[0])

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
