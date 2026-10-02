# Build ticket: Announcement AI summaries (end-to-end)

Type: task
Status: ready-for-agent
Blocked by: 01 (`system` trigger + verdict-less `Summary`)

> Ticket 03 of the spec-06 execution effort. Fixed inputs: ADR-0004
> (stateless Python worker, fetches via NestJS data APIs), ADR-0005 (system-
> caller path), ADR-0007 (JobBus claim-check pattern). Spec 04 already
> landed `Announcement.aiSummary` / `Announcement.aiSummaryAsOf` columns
> (`free-tier-disclosures` ticket 01) — this ticket is the first thing that
> actually writes into them.

## What to build

AI-generated plain-language summaries of company announcements/disclosures,
landing in the existing `Announcement.aiSummary` column and visible through
the existing spec-04 announcement read endpoints — no new entity, no new
read surface.

- New Python job `summarize-announcement` (additive `JobName`), payload
  `{ announcementId }`. The worker fetches the announcement's own content via
  a NestJS read API (new endpoint if nothing suitable exists yet) and
  summarizes it — the payload stays anchoring-only, no bulk disclosure text
  rides the queue (ADR-0004/0007 §3 posture).
- NestJS enqueues per newly-ingested/updated announcement (hook into the
  disclosures ingestion path) with `trigger: 'system'`, `requestedBy:
  'system'`. On completion, write the summary headline into
  `Announcement.aiSummary` and stamp `aiSummaryAsOf` — no migration needed,
  both columns already exist.
- Confirm (and if missing, add) `aiSummary`/`aiSummaryAsOf` on the existing
  announcement feed/detail response DTOs from spec 04.

## Acceptance criteria

- [ ] `summarize-announcement` added to `JobName` (additive) and wired
      through the Python worker's job dispatch.
- [ ] Enqueuing against a seeded announcement produces a non-empty summary
      written to `Announcement.aiSummary`, with `aiSummaryAsOf` stamped.
- [ ] Re-running for the same announcement is idempotent: a content-derived
      `jobId` collapses duplicate enqueues, and a legitimate re-summarize
      (e.g. after a headline correction) overwrites cleanly rather than
      duplicating state.
- [ ] The summary is visible through the existing spec-04 announcement read
      endpoints without a breaking response-shape change.
- [ ] Unit lane (worker handler) and integration lane (JobBus round-trip,
      testcontainers) both green.

## Out of scope

- Daily market brief, prospectus at-a-glance (tickets 02, 05).
- Changing how/when announcements are tagged or categorized — that's spec
  04's `free-tier-disclosures` effort, already resolved.
