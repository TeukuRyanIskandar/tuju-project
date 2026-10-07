"""The regulated Bursa/SC prospectus section skeleton (spec 06, ticket 04).

A Bursa/SC prospectus follows a regulated contents skeleton (the SC's
"Guidelines on Prospectuses" Part-I chapters), so the four regulated output
sections can be routed deterministically from the document's own headings —
no retrieval, no embeddings (research ticket 08's primary recommendation).

Each output section maps to candidate heading patterns (regex, matched
against the *normalized* heading text: casefolded, whitespace-collapsed,
leading enumeration stripped). Multiple headings may legitimately serve one
output section — e.g. the offer section draws on both "The Offering" (shares,
price range) and "Use of Proceeds" chapters.
"""

from __future__ import annotations

import re

from .models import ProspectusSection

# Anchored patterns, matched against normalized heading text (case-insensitive
# by construction). \b ends guard against "Risk Factors Relating To ..." style
# false positives living under other chapters.
SECTION_SKELETON: dict[ProspectusSection, tuple[str, ...]] = {
    # Shares, price range, use of proceeds.
    ProspectusSection.OFFER: (
        r"^the offering\b",
        r"^details? of the offering\b",
        # Real Bursa chapter titles: "Details of our IPO" / "Details of our
        # Public Offering" (all three demo-corpus prospectuses).
        r"^details? of (our|the) (ipo|public offering|offering)\b",
        r"^structure of the (offering|ipo|initial public offering)\b",
        r"^offer for sale\b",
        r"^new issue\b",
        r"^terms? of the offer(ing)?\b",
        r"^the offer\b",
        r"^use of proceeds\b",
        r"^utili[sz]ation of proceeds\b",
    ),
    # The business in its own chapter(s).
    ProspectusSection.BUSINESS: (
        r"^business overview\b",
        # Anchored at both ends: "Our business is concentrated on ..." is a
        # risk-factor bullet, not the business chapter.
        r"^our business$",
        r"^the business of (the|our) company\b",
        r"^business model\b",
        r"^business$",
    ),
    # Historical financials / key indicators.
    ProspectusSection.FINANCIALS: (
        r"^financial overview\b",
        r"^summary of key financial information\b",
        r"^key financial indicators?\b",
        r"^historical financial information\b",
        r"^summary financial information\b",
        r"^financial highlights\b",
        r"^financial and operational highlights\b",
        r"^financial information\b",
        r"^financial statements?\b",
    ),
    # The regulated risk-factors chapter.
    ProspectusSection.RISK_FACTORS: (
        r"^risk factors?\b",
        r"^principal risks\b",
    ),
}

_LEADING_ENUMERATION = re.compile(
    r"^(?:"
    # Dotted-no-trailing-dot FIRST (2.5 / 4.9.2): otherwise "2." wins the
    # alternation and strands "5 risk factors".
    r"\d+(?:\.\d+)+(?=\s)"
    r"|\d+(?:\.\d+)*[.)]"  # 2. / 2.1. / 3)
    r"|\([a-z0-9]+\)"  # (a) / (iii) / (3)
    r"|[a-z][.)]"  # a. / b)
    r"|(?:part|section|chapter)\s+\d+(?:\.\d+)*\s*[-–—:.]?\s*"  # Section 2 -
    r")\s*"
)


def normalize_heading(text: str) -> str:
    """Normalize a heading for skeleton matching.

    Strips surrounding whitespace and leading enumeration ("2.", "(b)",
    "Section 2 -"), collapses internal whitespace, and casefolds — so
    "SECTION 2 - RISK FACTORS" and "risk factors" both match
    ``^risk factors\\b``.
    """
    collapsed = " ".join(text.strip().split()).casefold()
    # A "Section 2" prefix can precede further enumeration ("Section 2.1.").
    while True:
        stripped = _LEADING_ENUMERATION.sub("", collapsed, count=1)
        if stripped == collapsed:
            return collapsed.rstrip(":").strip()
        collapsed = stripped


def _compiled() -> dict[ProspectusSection, tuple[re.Pattern[str], ...]]:
    return {
        section: tuple(re.compile(p) for p in patterns)
        for section, patterns in SECTION_SKELETON.items()
    }


_COMPILED = _compiled()


def matches_skeleton(heading_text: str) -> ProspectusSection | None:
    """Return the first output section whose skeleton matches this heading."""
    normalized = normalize_heading(heading_text)
    for section, patterns in _COMPILED.items():
        if any(p.search(normalized) for p in patterns):
            return section
    return None
