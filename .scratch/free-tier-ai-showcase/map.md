# free-tier-ai-showcase — execution effort (spec 06 implementation)

Breaking [spec 06 — AI showcase + IPO prospectus at-a-glance](../free-tier-specs/06-ai-showcase-and-prospectus.md)
into build tickets. Backend only (`apps/backend` + `services/ai`); touches
`packages/contracts` (additive).

Fixed inputs (do not re-decide): ADR-0001–0012, especially ADR-0004 (Postgres
sole-writer, S3 claim-check, stateless Python worker reading via NestJS data
APIs), ADR-0005 (system-caller path bypasses tier), ADR-0007 (job/result/
progress contract, additive job names). The spec-01 entities/worker (resolved
in `free-tier-data`) and spec-04's `Announcement.aiSummary`/`aiSummaryAsOf`
columns (resolved in `free-tier-disclosures`) are both already in place.

## Ticket status

| # | Ticket | Blocked by | Status |
| - | ------ | ---------- | ------ |
| 01 | [Wire contract: `system` trigger + verdict-less `Summary`](issues/01-wire-contract-system-trigger-and-verdictless-summary.md) | — | resolved |
| 02 | [Daily market brief (end-to-end)](issues/02-daily-market-brief.md) | 01 | resolved |
| 03 | [Announcement AI summaries (end-to-end)](issues/03-announcement-ai-summaries.md) | 01 | resolved |
| 04 | [Prospectus parse + section router](issues/04-prospectus-parse-and-section-router.md) | — | resolved |
| 05 | [Prospectus at-a-glance: LLM analysis + job + read endpoint](issues/05-prospectus-at-a-glance-analysis-and-endpoint.md) | 01, 04 | ready-for-agent |
| 06 | [ADR-0007 amendment (docs)](issues/06-adr-amendment.md) | 01, 02, 03, 05 | ready-for-agent |

## Frontier

Tickets **01, 02, 03, 04** are resolved. Ticket 05 is now unblocked (needs
01 and 04, both done). Ticket 06 is last — it documents the
job names 02/03/05 actually shipped with: `generate-market-brief` /
`summarize-announcement` (02/03, resolved) and whatever 05 lands as
`analyze-prospectus`.

## Decisions / notes so far

- **Job-shape call (not pinned by the spec itself):** spec 06 only pins the
  flagship `analyze-prospectus` job in detail; the two shallow artifacts
  (daily brief, announcement summaries) are specified only as "system-
  triggered" with no job name named. This execution effort gives each its
  own additive `JobName` — `generate-market-brief` and
  `summarize-announcement` — following the same JobBus/claim-check pattern as
  TA/FA/prospectus, rather than having NestJS call an LLM directly. Decided
  with the user before ticket-drafting; keeps all AI content in one module
  (`services/ai`) and exercises the same system-trigger path for all three.
- **ADR-0012 precedent:** amendments to an existing ADR land as a new,
  separately numbered file (ADR-0012 did this for ADR-0004/0007's ingestion
  posture), not an in-place edit — ticket 06 follows the same convention
  (next number: **ADR-0013**).
- **No new entities needed for announcement summaries**: `Announcement.
  aiSummary`/`aiSummaryAsOf` already exist from spec 04 (ticket 01 of
  `free-tier-disclosures`) — ticket 03 only needs to populate them.
- **Corpus is ready**: the 3 real 2025 Bursa IPO prospectus PDFs are already
  downloaded to `.scratch/free-tier/demo-corpus/prospectuses/`; `IpoListing.
  prospectusS3Key` already exists on the entity (spec 01, ticket 10) — ticket
  04 seeds rows + uploads, it isn't inventing the column.
- **Ticket 01 resolved:** `Trigger` gained `'system'`; a new `SystemSummary`
  (`{ headline, asOf }`, no verdict) schema was added alongside the existing
  `Summary`, and `JobResult.summary` is now `Summary | SystemSummary`.
  Review catch: `Summary`/`SystemSummary` had to become `z.strictObject(...)`
  — a plain `z.object(...)` strips unknown keys, which let a malformed
  verdict-bearing summary silently (and wrongly) match the `SystemSummary`
  arm of the union instead of being rejected. Fallout: the one backend
  consumer reading `result.summary.verdict` unconditionally
  (`AnalysisResultStore`, plus one int-spec assertion) now narrows with
  `'verdict' in result.summary` first — that table is TA/FA-only and
  unreachable by system-triggered results until tickets 02/03/05 land their
  own persistence paths. **Gotcha for 02/03/05:** `@tuju/contracts` only
  exports ESM (`package.json` has no `"require"` condition) — `apps/backend`
  compiles to CommonJS, so any NEW value-level (non-`import type`) import
  from the contract package into the backend throws
  `ERR_PACKAGE_PATH_NOT_EXPORTED` at runtime/under Jest. Every existing
  backend import from the package is type-only; keep it that way unless the
  package gains a CJS build.
- **Tickets 02/03 resolved together** (shared infra: `BackendClient`,
  `JobBus.deriveJobId` generalisation, the jobId-prefix-recovery pattern).
  Notes for ticket 06:
  - **`jobId` split is intentional, not an oversight**: the BullMQ dedup id
    (TS `JobBus.deriveJobId`, hyphen-joined — `brief-YYYY-MM-DD`,
    `ann-{id}`) and the Python worker's own `JobResult.jobId` field (colon-
    joined — `brief:YYYY-MM-DD`, `ann:{id}`) are two independently computed
    strings, same as the pre-existing `ta-`/`ta:` split. No shared
    cross-language constant exists for either half; both sides are hand-
    synced constants, documented in-file, flagged here as the kind of gap a
    future `packages/contracts` plain-constant export (not just Zod models)
    could close.
  - **Class-2 cache is per-feature, not automatic**: `MarketBriefStore`
    needed its own `BRIEF_CACHE_PREFIX`, deliberately excluded from the
    nightly-ingest-swept `READ_CACHE_PREFIXES` — its data changes on the
    JobBus result's own async cadence, not the nightly ingest transaction,
    so the store invalidates its one key itself. The first pass missed
    this cache entirely; a spec-conformance review caught it.
  - **Cost-bounding is a real correctness axis for every future
    system-triggered job**, not just ticket 03's: "enqueue per
    newly-ingested/updated row" needs an explicit not-yet-processed
    predicate (here, `aiSummary IS NULL`) — BullMQ's own content-derived
    dedup does NOT bound cost on its own once the queue's
    `removeOnComplete` retention is shorter than the enqueue cadence (1h vs.
    a 24h nightly ingest here). Worth re-checking for ticket 05's
    `analyze-prospectus` enqueue trigger.
- **Ticket 04 resolved** (Docling parse + heading router, no LLM). 11 of 12
  (PDF x section) cells located; the one explicit fallback is Fibromat's
  business chapter, which lives in Part 2 (outside the Part-1-only corpus).
  Review catch: the first pass passed its unit tests but routed poorly on the
  real PDFs because Docling emits every heading at level 1; the router now
  recovers hierarchy from the prospectus's dotted section numbering. Notes
  for ticket 05: located slices can reach ~100k chars and fallbacks are the
  whole document (450-640k chars), so per-section budgeting is required;
  first parse is 4-11 min/PDF on CPU (re-runs ~ms via the sha256-keyed S3
  claim-check); the seeded PDFs sit at `prospectus/{fileName}`, outside the
  worker's scoped `analysis/` read prefix. Details in the ticket's `## Answer`.

