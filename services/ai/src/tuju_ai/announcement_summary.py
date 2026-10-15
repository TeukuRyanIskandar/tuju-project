"""Announcement AI summary job (spec 06, ticket 03) — verdict-less ``SystemSummary``.

NO real LLM call yet — same scaffold posture as market_brief.py. A
deterministic plain-language template over the announcement's own structured
metadata (title, category, company, filedAt), fetched via the NestJS read API
(ADR-0004): the payload carries only the anchoring ``announcementId``, no bulk
disclosure text rides the queue. The source `Announcement` row
never stores the filing's body text (Bursa detail 403s, spec 01), so the
summary narrates the filing's metadata, not document content.
"""

from __future__ import annotations

from typing import Any, TypedDict

from .config import JOB_SUMMARIZE_ANNOUNCEMENT
from .contracts_generated import AnnouncementSummaryJobEnvelope
from .jobs.pipeline import JobContext, JobDefinition, JobOutput, hour_bucket

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


def _work(envelope: AnnouncementSummaryJobEnvelope, ctx: JobContext) -> JobOutput:
    announcement_id = str(envelope.payload.announcementId)
    ctx.advance("Fetching announcement")
    summary = compose_announcement_summary(
        ctx.deps.backend.get_announcement(announcement_id)
    )
    ctx.advance()
    return JobOutput(
        artifact_key=f"announcement/{announcement_id}/{hour_bucket(envelope.asOf)}.json",
        artifact={
            "schemaVersion": ctx.schema_version,
            "announcementId": announcement_id,
            "headline": summary["headline"],
            "category": summary["category"],
            "sourceTitle": summary["sourceTitle"],
        },
        headline=summary["headline"],
    )


# One job per announcement, independent of asOf (ADR-0007 §2): a legitimate
# re-summarize overwrites the same Postgres row rather than needing a distinct
# job history.
ANNOUNCEMENT_SUMMARY_JOB = JobDefinition(
    name=JOB_SUMMARIZE_ANNOUNCEMENT,
    envelope=AnnouncementSummaryJobEnvelope,
    result_key=lambda e: str(e.payload.announcementId),
    work_steps=[
        ("fetching-announcement", "Fetching announcement"),
        ("summarizing", "Summarizing announcement"),
    ],
    work=_work,
)
