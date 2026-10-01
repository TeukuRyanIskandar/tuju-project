# Ticket 01 — Disclosure model additions + label mapping + news tagging + richer demo snapshot

Effort: free-tier-disclosures (spec 04). Type: task. Status: resolved.

Spec: `.scratch/free-tier-specs/04-announcements-news-corporate-events.md` §1
(categorisation), §2 (RSS ticker-tagging), §5 (provenance), "Model additions".

## Scope

The model/ingestion half of spec 04 — everything the read endpoints (ticket 02)
will read:

1. **Additive columns** (one migration `1727900000000-DisclosureReadModel`):
   `announcements.ai_summary_as_of timestamptz NULL` (spec: the field this spec
   owns, the generation job is spec 06's) and `news_article_tags.matched_alias
   varchar NOT NULL` (table is empty — the tagger is new).
2. **Label→enum categorisation** (`src/data/adapters/announcement-labels.ts`):
   the aggregator adapter's own raw labels map onto the stable
   `AnnouncementCategory` enum; unknown label → `OTHER` (never drop a row).
3. **Deterministic news tagging** (`src/ingestion/news-tagging.ts`): case-
   insensitive whole-word match of the headline against each company's alias
   set (`shortName` via Instrument, `fullName`, curated `aliases`); conservative
   — no fuzzy/substring; multi-company hits all tagged; no-match → market-level
   (empty tags). A step inside `persistNews` (the demo RSS cadence is folded
   into the nightly ingest), **not** an AI job.
4. **Richer demo snapshot rows** (`demo-adapters.ts`): multiple categories per
   company (incl. `SHAREHOLDING_CHANGE` dealings and an unknown-label → `OTHER`
   row), a `FINANCIAL_RESULTS` announcement per latest-4 quarters (feeds the
   results calendar), corporate actions across types with now-relative exDates
   (so the default calendar window has content; the DY dividend row keeps its
   fixed trailing-window date), and news headlines covering the tagging cases
   (shortName hit, alias hit, multi-company, substring-reject, market-level).
5. **`cache:disclosures:` prefix** + sweep on nightly ingest (post-commit) and
   the decision-B purge.
6. Updated ingestion integration test (counts, tag assertions, purge removes
   tags with their articles).

## Out of scope

Ticket 02 (read endpoints), CorporateAction date-depth columns, the
AI-summary *job* (spec 06).

## Answer

Done in the working tree; verified (typecheck clean, unit + integration lanes
green incl. updated `ingestion.int.spec.ts`). See map decisions for the
NOT-NULL and now-relative-date calls.
