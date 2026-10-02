"""Plain-language announcement summary (spec 06, ticket 03).

NO real LLM call yet — same scaffold posture as graph.py/market_brief.py. A
deterministic plain-language template over the announcement's own structured
metadata (title, category, company, filedAt). The source `Announcement` row
never stores the filing's body text (Bursa detail 403s, spec 01), so the
summary narrates the filing's metadata, not document content.
"""

from __future__ import annotations

from typing import Any, TypedDict

# Mirrors apps/backend/src/data/entities/enums.ts AnnouncementCategory.
_CATEGORY_VERBS: dict[str, str] = {
    "FINANCIAL_RESULTS": "filed its financial results",
    "ENTITLEMENT": "announced a shareholder entitlement",
    "SHAREHOLDING_CHANGE": "disclosed a shareholding change",
    "GENERAL": "filed a disclosure",
    "ADDITIONAL_LISTING": "filed an additional listing notice",
    "MEETING": "announced a shareholder meeting",
    "CIRCULAR": "issued a circular to shareholders",
    "ANNUAL_REPORT": "filed its annual report",
    "LISTING": "filed a listing notice",
    "OTHER": "filed a disclosure",
}
_DEFAULT_VERB = "filed a disclosure"


class AnnouncementSummary(TypedDict):
    headline: str
    category: str
    sourceTitle: str


def compose_announcement_summary(announcement: dict[str, Any]) -> AnnouncementSummary:
    """Build the summary from a `GET /announcements/{id}` response."""
    company = announcement.get("companyName") or "The company"
    category = str(announcement.get("category") or "GENERAL")
    title = announcement.get("title") or ""
    verb = _CATEGORY_VERBS.get(category, _DEFAULT_VERB)

    headline = f"{company} {verb}: {title}".rstrip(": ")
    return {"headline": headline, "category": category, "sourceTitle": title}
