# Build ticket: Announcement AI summaries (end-to-end)

Type: task
Status: resolved
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

## Resolution notes

- **No real LLM call**, same scaffold posture as ticket 02/`graph.py`:
  `announcement_summary.py` is a deterministic plain-language template keyed
  on category (`AnnouncementCategory` → verb phrase), not an LLM prompt. The
  source `Announcement` row never stores the filing's body text (Bursa detail
  403s, spec 01), so the summary necessarily narrates the filing's own
  metadata (company, category, title), not document content.
- **New `GET /announcements/:id`** (`disclosures.controller.ts` +
  `DisclosuresService.getAnnouncementById`) is the worker's only route to an
  announcement's content, via the shared `BackendClient` from ticket 02.
  Extracted the pre-existing `market.service.ts` UUID-shape pre-check into a
  shared `isUuid()` helper (`stocks/filters.ts`) rather than copy-pasting a
  second regex, after a standards review flagged the duplication.
- **Cost-bounding fix (caught by a spec-conformance review, not the first
  pass):** the first implementation re-read every announcement id from
  `persistAnnouncements` and enqueued `summarize-announcement` for all of
  them on every nightly ingest — forever, since the demo aggregator re-serves
  the identical static snapshot nightly and the BullMQ dedup window
  (`removeOnComplete: 1h`) is far shorter than the ~24h cadence, so content-
  derived jobIds never actually collapsed the repeat enqueues. Narrowed to
  `aiSummary IS NULL` rows only: covers genuinely new rows AND a title
  correction (the natural key includes `title`, so a corrected title is a
  new row with a fresh null `aiSummary` anyway), without ever re-summarizing
  an already-summarized, unchanged row every single night (spec 06's "AI
  cost bounded by us" operator goal). Covered by a dedicated
  `ingestion.int.spec.ts` test (spies on `JobBus.enqueue`, asserts zero
  re-enqueues once every row is marked summarized, then exactly one once a
  row's summary is cleared).
- **Enqueued AFTER the nightly-ingest transaction commits**, not inside it —
  the worker's `GET /announcements/:id` read must see committed data.
  `EodIngestService` gained a `JobBus` constructor dependency (producer-only;
  `IngestionModule`/`WorkerModule` import `JobBusModule`).
- **`AnnouncementSummaryStore`** writes straight into the pre-existing
  `Announcement.aiSummary`/`aiSummaryAsOf` columns (no new table, no claim-
  check pointer stored — the full S3 artifact is audit/re-run-only, per the
  spec's "thin wire summary" posture). It recovers the announcement id by
  stripping the Python worker's `ann:` `JobResult.jobId` prefix — the same
  prefix-parsing pattern `MarketBriefStore` uses for its `briefDate` (NOT
  the same pattern `AnalysisResultStore` uses, which derives its domain key
  from the S3 artifact path instead; an initial doc-comment claimed otherwise
  and was corrected after a standards review).
- **Test coverage**: `services/ai/tests/test_announcement_summary.py` (pure
  unit), `test_handler.py` additions (dispatch, `ann:{id}` jobId shape,
  bad-envelope terminal path), and `disclosures.int.spec.ts` additions
  (JobBus → store → `Announcement.aiSummary` round trip incl. the BullMQ-
  level `ann-{id}` jobId collapse, and a legitimate re-summarize overwriting
  the same row rather than duplicating state) — unit + integration both
  green per the acceptance criteria.
