"""Per-section input budgeting for the prospectus LLM steps (ticket 05).

Routed sections can be enormous: a located slice reaches ~118k chars, and a
FALLBACK section is the WHOLE document (450-640k chars) — far beyond what we
want to pay for per call, and beyond many models' windows. Every section's
context is therefore bounded here before it is prompted.

BUDGETS (characters; ~3 chars/token is the conservative estimate the cost
guard uses, so 240k chars ≈ 80k tokens):

* ``SECTION_CHAR_BUDGET`` — 240_000 chars per section step (offer, business,
  financials, risk-factors).
* ``CORNERSTONE_CHAR_BUDGET`` — 60_000 chars of cornerstone-relevant excerpts.
* The what-to-watch reduce never re-reads the document; its input is the four
  structured outputs (a few KB).

Worst case input per document: 4 x 240k + 60k = ~1.02M chars ≈ 340k tokens
(≈ $0.10 on Gemini 2.5 Flash, ≈ $1.0 even on Claude Sonnet 4.5), inside the
~$2/doc ceiling even for the Flash-vs-Pro/Sonnet A/B (spec 06).

Two trimming strategies, chosen by whether the router LOCATED the section:

* located  → the section is coherent; keep head (75%) + tail (25%) at
  paragraph boundaries with an explicit truncation marker;
* fallback → the "section" is the whole document; keep the most relevant
  paragraphs (keyword-scored per section), in reading order.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .models import ProspectusParse, ProspectusSection

SECTION_CHAR_BUDGET = 240_000
CORNERSTONE_CHAR_BUDGET = 60_000

_SEP = "\n\n"
_MARKER = "\n\n[... {n:,} characters omitted to fit the context budget ...]\n\n"

# Fallback relevance keywords, lower-case substrings.
_KEYWORDS: dict[str, tuple[str, ...]] = {
    ProspectusSection.OFFER.value: (
        "public issue", "offer for sale", "ipo price", "issue price", "offer price",
        "use of proceeds", "utilisation of proceeds", "gross proceeds", "new shares",
        "placement", "market capitalisation", "price per share",
    ),
    ProspectusSection.BUSINESS.value: (
        "principal activities", "our business", "business overview", "products",
        "customers", "business model", "our group", "manufactur", "competitive strengths",
        "business strategy", "future plans",
    ),
    ProspectusSection.FINANCIALS.value: (
        "revenue", "profit after tax", "profit before tax", "gross profit",
        "financial highlights", "financial year ended", "financial period",
        "net profit", "cash flow", "total assets", "ebitda", "margin",
    ),
    ProspectusSection.RISK_FACTORS.value: (
        "risk factor", "risk", "adversely affect", "may not be able", "dependence on",
        "we depend", "no assurance", "uncertain",
    ),
}


@dataclass(frozen=True)
class Fitted:
    """A budgeted section context + how it was obtained (recorded in the artifact)."""

    text: str
    input_chars: int
    truncated: bool


def _truncate_head_tail(text: str, budget: int) -> str:
    paragraphs = text.split(_SEP)
    head_budget, tail_budget = int(budget * 0.75), int(budget * 0.25)
    head: list[str] = []
    used = 0
    for p in paragraphs:
        if used + len(p) + len(_SEP) > head_budget:
            break
        head.append(p)
        used += len(p) + len(_SEP)
    tail: list[str] = []
    tail_used = 0
    for p in reversed(paragraphs[len(head):]):
        if tail_used + len(p) + len(_SEP) > tail_budget:
            break
        tail.append(p)
        tail_used += len(p) + len(_SEP)
    tail.reverse()
    omitted = max(len(text) - used - tail_used, 0)
    # A pathological single giant paragraph: hard-slice it.
    if not head and not tail:
        return text[:budget]
    return _SEP.join(head) + _MARKER.format(n=omitted) + _SEP.join(tail)


def _select_relevant(text: str, budget: int, keywords: tuple[str, ...]) -> str:
    paragraphs = text.split(_SEP)
    scored = []
    for i, p in enumerate(paragraphs):
        low = p.lower()
        score = sum(low.count(k) for k in keywords)
        scored.append((-score, i, len(p)))
    scored.sort()
    chosen: list[int] = []
    used = 0
    for neg_score, i, size in scored:
        if neg_score == 0 and chosen:
            break  # nothing relevant left; don't pad with noise
        if used + size + len(_SEP) > budget:
            continue
        chosen.append(i)
        used += size + len(_SEP)
    if not chosen:
        return text[:budget]
    chosen.sort()
    out: list[str] = []
    prev = -1
    for i in chosen:
        if prev != -1 and i != prev + 1:
            out.append("[...]")
        out.append(paragraphs[i])
        prev = i
    return _SEP.join(out)


def fit_section(
    section: str, content: str, *, located: bool, budget: int = SECTION_CHAR_BUDGET
) -> Fitted:
    """Bound ``content`` to ``budget`` chars using the strategy for ``located``."""
    n = len(content)
    if n <= budget:
        return Fitted(text=content, input_chars=n, truncated=False)
    if located:
        text = _truncate_head_tail(content, budget)
    else:
        text = _select_relevant(content, budget, _KEYWORDS.get(section, ()))
    return Fitted(text=text, input_chars=len(text), truncated=True)


_CORNERSTONE = re.compile(r"cornerstone", re.IGNORECASE)


def cornerstone_context(
    parse: ProspectusParse, budget: int = CORNERSTONE_CHAR_BUDGET
) -> Fitted | None:
    """Excerpts mentioning cornerstone investors (±1 neighbouring block).

    Independent of the section router: cornerstone details live in different
    chapters across prospectuses (IPO details, plan of distribution, summary).
    Returns ``None`` when the document never mentions them (the caller then
    skips the LLM call entirely).
    """
    blocks = [b for b in parse.blocks if b.text.strip()]
    hits = [i for i, b in enumerate(blocks) if _CORNERSTONE.search(b.text)]
    if not hits:
        return None
    wanted: list[int] = []
    seen: set[int] = set()
    for i in hits:
        for j in (i - 1, i, i + 1):
            if 0 <= j < len(blocks) and j not in seen:
                seen.add(j)
                wanted.append(j)
    wanted.sort()
    parts: list[str] = []
    used = 0
    truncated = False
    prev = -1
    for j in wanted:
        text = blocks[j].text
        if used + len(text) + len(_SEP) > budget:
            truncated = True
            continue
        if prev != -1 and j != prev + 1:
            parts.append("[...]")
        parts.append(text)
        used += len(text) + len(_SEP)
        prev = j
    joined = _SEP.join(parts)
    return Fitted(text=joined, input_chars=len(joined), truncated=truncated)
