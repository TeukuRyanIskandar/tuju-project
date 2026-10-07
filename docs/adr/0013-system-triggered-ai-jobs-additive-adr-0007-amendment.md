# ADR-0013: System-triggered AI jobs — additive amendment to ADR-0007 (`trigger: 'system'`, verdict-less summary, three new job names)

- Status: Accepted
- Date: 2026-10-07
- Deciders: Bursa platform free-tier AI showcase effort (wayfinder map: Free-Tier AI Showcase — spec 06)
- Context ticket: `.scratch/free-tier-ai-showcase/issues/06-adr-amendment.md`
- Spec: `.scratch/free-tier-specs/06-ai-showcase-and-prospectus.md`
- Builds on: [ADR-0001](0001-redis-bullmq-nestjs-python-jobbus.md) (JobBus / BullMQ seam), [ADR-0002](0002-monorepo-pnpm-turborepo-python-own-world.md) (`packages/contracts` is the single cross-language seam), [ADR-0004](0004-data-layer-postgres-typeorm-hybrid-ingestion-s3-claimcheck.md) (NestJS sole Postgres writer; S3 claim-check; stateless Python worker; proxied artifact reads), [ADR-0005](0005-self-hosted-auth-nestjs-session-tier-capability-seam.md) (trusted system-caller path bypasses tier), [ADR-0007](0007-job-result-progress-contract-bullmq.md) (job/result/progress contract — **amended additively here, not edited in place**), [ADR-0012](0012-dedicated-nestjs-ingestion-worker-ts-indicators.md) (precedent for landing an amendment as a new numbered file)

## Context

ADR-0007 pinned the job contract around two **user- or price-move-triggered**
job types (`analyze-technical`, `analyze-fundamental`), each ending in a
verdict-bearing `Summary` (`bullish`/`bearish`/`neutral` or
`undervalued`/`fairly-valued`/`overvalued`).

Spec 06 adds three AI artifacts that do not fit that shape:

- a **daily market brief** (scheduled, no symbol/timeframe anchor);
- a per-row **announcement summary** (curated/scheduled, anchored by announcement id);
- an **IPO prospectus at-a-glance** (the flagship; curated, operator-enqueued,
  long-running document analysis).

None is user-initiated, none has a bullish/bearish or over/under-valued axis,
and the prospectus job is far longer-running than TA/FA (a first Docling parse
on CPU takes 4-11 minutes). Writing the amendment after tickets 01-05 landed
means this ADR records the shapes that **actually shipped**, including the
gotchas found along the way.

Decision inputs:

- All AI content stays in one module (`services/ai`) and one transport (JobBus),
  rather than NestJS calling an LLM directly (map decision, ticket 01).
- ADR-0004 still holds: the Python worker is stateless, reads via NestJS data
  APIs (and narrow S3 prefixes), writes claim-check artifacts, and never touches
  Postgres.
- Free-tier scope: no user-triggered AI, no paid-tier gating to design.

## Decision

### 0. Everything below is additive

`analyze-technical` and `analyze-fundamental`, their payloads
(`TechnicalPayload`, `FundamentalPayload`), their phase enums
(`TechnicalPhase`, `FundamentalPhase`), their `JobId` derivation, and the
verdict-bearing `Summary` are **unchanged**. Enums only gained members
(ADR-0007's "append, never remove or renumber" rule); no field was removed,
renamed or made optional on any pre-existing schema. Existing TA/FA consumers
compile and behave as before, with one narrow exception noted in Consequences
(a type-narrowing on `summary.verdict`).

### 1. `Trigger` gains `'system'`

`Trigger = 'user' | 'price-move' | 'system'`. `'system'` extends the **ADR-0005
trusted system-caller path** (which already bypasses tier gating for
price-move-triggered TA/FA) to scheduled/curated AI content:

- envelope `requestedBy` is the literal `'system'` (no user id);
- the path **bypasses tier gating**, as `price-move` does;
- there is no HTTP route that lets an end user enqueue these jobs (see Out of scope).

### 2. Three new job names on the existing `analysis` queue

Same queue, same `JobEnvelope<P>` (ADR-0003: all triggers ride one queue), same
JobBus retention/retry (3 attempts, fixed 5s backoff; `removeOnComplete` 1h,
`removeOnFail` 24h).

| Job name | Payload | Phases | Enqueued by |
| -------- | ------- | ------ | ----------- |
| `generate-market-brief` | `MarketBriefPayload = {}` (anchored only by envelope `asOf`) | `queued`, `fetching-market-data`, `drafting-narrative`, `persisting-artifact`, `done` | scheduled, from the ingestion worker |
| `summarize-announcement` | `AnnouncementSummaryPayload = { announcementId: uuid }` | `queued`, `fetching-announcement`, `summarizing`, `persisting-artifact`, `done` | per newly-ingested announcement with no summary |
| `analyze-prospectus` | `ProspectusPayload = { prospectusId: string }` (the `IpoListing.id`; deliberately `z.string().min(1)`, not `z.uuid()`) | `queued`, `fetching-prospectus`, `parsing-document`, `analyzing-sections`, `synthesizing-watchlist`, `persisting-artifact`, `done` | manual ops command `enqueue-prospectus` |

The union `Phase` used by the generic `JobProgress` envelope includes all of
these. Payloads carry **anchoring context only**; the worker fetches the rest
through NestJS read APIs / S3 (ADR-0004), so no document content rides the queue.

### 3. Verdict-less `SystemSummary`; `JobResult.summary = Summary | SystemSummary`

A prospectus (and a brief or an announcement summary) has no honest
bullish/bearish or over/under-valued verdict. Rather than invent one, a second
thin summary was added:

```ts
SystemSummary = z.strictObject({ headline: string, asOf: iso datetime })
JobResult.summary = z.union([Summary, SystemSummary])
```

Both `Summary` and `SystemSummary` are **`z.strictObject`** (JSON Schema
`additionalProperties: false`). This was a review catch, not a stylistic choice:
with plain `z.object`, Zod strips unknown keys, so a verdict-bearing payload
with a **malformed** `verdict` would silently strip down to a valid
`SystemSummary` and match the wrong arm of the union instead of being rejected.

### 4. Provenance lives in the artifact, not on the wire

The `source: 'real'` provenance marker (the prospectus is the one showcase
artifact built on real, licence-safe data) is written **only into the rich S3
artifact**. The `JobResult` wire shape and `SystemSummary` carry no provenance
field; the contract was not widened for it.

### 5. Two job-id spaces, hand-synced

| Job | BullMQ dedup id (TS `JobBus.deriveJobId`, hyphen-joined) | `JobResult.jobId` (Python `config.py`, colon-joined) |
| --- | --- | --- |
| market brief | `brief-YYYY-MM-DD` (date-bucketed, not hour) | `brief:YYYY-MM-DD` |
| announcement summary | `ann-{announcementId}` (independent of `asOf`) | `ann:{announcementId}` |
| prospectus | `prospectus-{prospectusId}` (independent of `asOf`) | `prospectus:{prospectusId}` |

The split mirrors the pre-existing `ta-…` / `ta:…` one (BullMQ forbids `:` in
custom ids). The stores on the NestJS side parse the colon-form prefix back out
of `JobResult.jobId` to recover their domain key. There is **no shared
cross-language constant**; both halves are hand-synced, documented in-file
(`prospectusBullJobId` on the TS side; `*_JOB_ID_PREFIX` constants in
`services/ai/src/tuju_ai/config.py`). See Consequences.

### 6. Read-cache: per-feature class-2 prefixes, not the nightly sweep

The brief and prospectus read caches (`BRIEF_CACHE_PREFIX`,
`PROSPECTUS_CACHE_PREFIX`) are **deliberately excluded from
`READ_CACHE_PREFIXES`**, the set swept at the end of the nightly ingest
transaction. Their data changes on the JobBus result's own async cadence, not
the ingest transaction, so each store **invalidates its own key** when it
persists a result. Pinned by `prospectus-analysis.int-spec.ts`.

### 7. Cost-bounding is an explicit predicate, not BullMQ dedup

BullMQ's content-derived dedup does **not** bound LLM spend on its own:
`removeOnComplete` retains completed jobs for 1h, shorter than the enqueue
cadence (24h nightly), so the same id can be enqueued again after eviction.
Each system job therefore carries an explicit "not yet processed" predicate:

- announcements: enqueue only where `aiSummary IS NULL`;
- prospectus: enqueue only where no `ProspectusAnalysis` row exists (a `--force`
  flag overrides, for deliberate re-runs);
- prospectus enqueue is **not a cron** — it is a manual ops command on the
  ingestion-worker entrypoint, `enqueue-prospectus [id]` / `enqueue-prospectus --force <id>`
  (`worker-main.ts`), because the prospectus corpus is curated and each run costs real money.

### 8. Worker: long-running job support

- **5-minute BullMQ lock** (`WORKER_LOCK_DURATION_MS`, default `300000`).
- Handler invocation runs via **`asyncio.to_thread`**, so the event loop (and
  BullMQ's lock-renewal task, every `lockDuration/2`) keeps ticking during the
  blocking 4-11 min first Docling parse. Without this the lock would lapse and
  the job would be re-delivered mid-parse.
- The Docling parse is cached as an **S3 claim-check keyed by prospectus id + PDF
  sha256** (`analysis/prospectus/{id}/parse.json`); re-runs reuse it in ~ms and
  a changed PDF re-parses.
- A **progress heartbeat** (30s default) is emitted while the long steps run so
  the UI's step-based progress (ADR-0007 §4) does not look hung.

### 9. LLM access: OpenRouter behind a synchronous seam

- **No LLM call from NestJS.** All LLM calls are in `services/ai`.
- A synchronous **`LLMClient`** protocol with two implementations:
  `OpenRouterClient` (production) and `FakeLLMClient` (tests, keyless dev).
- Config via env: `OPENROUTER_API_KEY`, `LLM_MODEL` (default
  `google/gemini-2.5-flash`), plus optional `LLM_BASE_URL`, `LLM_PROMPT_CACHE`,
  `LLM_PRICE_TABLE_JSON`, `LLM_COST_CEILING_USD`.
- **Cost ceiling ~$2 per document** (`DEFAULT_COST_CEILING_USD = 2.0`), enforced
  twice: a **pre-call projected** check and a **post-call actual** guard; crossing it is a
  terminal failure.
- A **missing `OPENROUTER_API_KEY` fails the prospectus job terminally, before
  any spend**, rather than crashing the worker or retrying. The key is never logged.

### 10. Narrow S3 read scope for the PDFs

The seeded prospectus PDFs live at `prospectus/{fileName}`, outside the worker's
`analysis/` artifact prefix. Read access is widened by exactly one narrow,
dedicated method (`ArtifactStore.get_prospectus_pdf`) that only accepts keys
under the configured `prospectus/` prefix. **General artifact reads stay under
`analysis/`**; writes stay under `analysis/` (ADR-0004 write boundary).

### 11. Backend surface for the prospectus

- A **thin `ProspectusAnalysis` table** (migration `1728200000000`), written by
  NestJS from the `JobResult` (sole writer, ADR-0004): headline/asOf and the
  artifact pointer, not the rich content.
- `GET /ipo/:prospectusId/reference` — **worker-facing**, uncached IPO reference
  row (the worker needs the live Shariah status).
- `GET /ipo/:prospectusId/at-a-glance` — thin summary for first-glance render.
- `GET /ipo/:prospectusId/at-a-glance/artifact` — the rich artifact,
  **proxied by NestJS** from S3 (ADR-0004: the browser never gets an S3 URL).

## Consequences

- **Good:** one transport, one module, one contract for all AI content; the
  TA/FA path is untouched; the system path is a small, explicit extension of an
  ADR that already blessed the bypass. Cost is bounded by predicates and a hard
  per-document ceiling rather than hoping dedup holds.
- **ESM/CJS gotcha:** `@tuju/contracts` is **ESM-only** (no `require` export
  condition) while `apps/backend` compiles to CommonJS. Any **value-level**
  import from the package into the backend throws `ERR_PACKAGE_PATH_NOT_EXPORTED`
  at runtime/under Jest. Backend imports from `@tuju/contracts` must stay
  **`import type`** (e.g. `job-names.ts` uses `satisfies Record<string, JobName>`
  so drift is still a compile error). Revisit only if the package gains a CJS build.
- **One consumer was narrowed:** `AnalysisResultStore` (TA/FA-only table) read
  `result.summary.verdict` unconditionally; it now narrows with
  `'verdict' in result.summary`. Behaviour for TA/FA results is unchanged;
  system results never reach that table.
- **Hand-synced job ids:** the hyphen/colon split for three more jobs is a
  drift risk with no compiler help across the TS/Python boundary. Closing it
  would need `packages/contracts` to export plain constants (not just Zod
  models) — deferred.
- **Known limitation — Shariah join by name:** `IpoListing` has no FK to
  `Company`, so the `/reference` endpoint joins the Shariah status by
  **normalized company name** (`lower(trim(full_name))`). A name mismatch yields
  `shariahStatus: null` (the worker then reports the Shariah source as
  unavailable) rather than a wrong answer, but the join is fragile; a proper FK
  is the fix.
- **Operational:** the prospectus worker needs a longer lock and a thread for
  the handler; a cold first parse is minutes, not seconds. CPU-only torch is
  pinned for Docling.
- **Unvalidated quality:** the LLM seam ships with `FakeLLMClient` for tests and
  keyless dev; LLM output quality on real prospectuses has **not** been validated
  (see Out of scope). The parse/router stage (ticket 04) was verified on the
  three real PDFs.

## Out of scope

- **Peer valuation** for the prospectus (needs peer data not in the free tier).
- **Automated prospectus fetching** from Bursa/SC; the corpus is curated and
  seeded, and enqueue is a manual ops command.
- **User-triggered AI jobs** and any tier gating/quotas on them; everything here
  is `trigger: 'system'`.
- **Real-LLM quality validation** and the Flash vs. Pro/Sonnet A/B comparison,
  pending the operator's OpenRouter key.
- **Real announcement and market-brief LLM calls**: those two jobs are wired
  end-to-end through the contract but still produce **templated** text; only the
  prospectus job is built against the LLM seam.
- A shared cross-language job-id constant (see Alternatives).

## Alternatives considered

- **NestJS calls the LLM directly for the shallow artifacts (brief, announcement summaries).**
  Rejected: splits AI logic across two runtimes, bypasses the JobBus
  progress/result/failure machinery, and would put provider keys and long
  blocking calls in the API process. Each artifact got its own job name instead.
- **Reuse `Summary` with a nullable/optional `verdict`.** Rejected: it would
  weaken the existing TA/FA contract (every consumer would have to handle
  `null`), blur the JSON Schema, and change a shipped shape. A separate
  `SystemSummary` leaves `Summary` untouched. (A strict union was needed to make
  this work safely — §3.)
- **Shared cross-language job-id constants** (contract-exported plain strings
  for the `brief-`/`brief:` etc. prefixes). Deferred: valuable but requires the
  contracts package to ship non-schema constants and a codegen path for Python;
  hand-synced constants with in-file notes are adequate at three jobs.
- **A cron for prospectus enqueue.** Rejected: curated corpus plus real spend
  per run; a manual, idempotent-by-predicate ops command is safer.
- **Rely on BullMQ dedup for cost control.** Rejected: retention (1h) is
  shorter than the enqueue cadence, so dedup does not bound spend (§7).
