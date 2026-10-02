# Build ticket: Daily market brief (end-to-end)

Type: task
Status: resolved
Blocked by: 01 (`system` trigger + verdict-less `Summary`)

> Ticket 02 of the spec-06 execution effort. Fixed inputs: ADR-0004 (Python
> worker is stateless, fetches via NestJS data APIs, never Postgres
> directly), ADR-0005 (system-triggered jobs bypass `@RequiresJob`/tier —
> the trusted system-caller path), ADR-0007 (JobBus claim-check pattern).
> Spec 06's honesty caveat: the brief narrates the demo's synthetic,
> "illustrative"-labelled price series and must say so, not present it as
> real market movement.

## What to build

A daily, plain-language market brief, demoable end-to-end: a nightly system-
triggered job produces it, and anyone (anonymous) can read the latest one.

- New Python job `generate-market-brief` (additive `JobName`) on the
  `analysis` queue. No symbol/timeframe anchor — the payload carries at most
  the anchoring `asOf`; the worker fetches whatever index/sector level data
  it needs via the existing spec-05 market-overview read API.
- The narrative must prominently flag the series as illustrative/synthetic
  — this is a demo-data posture requirement, not a nice-to-have caption.
- Emits the new verdict-less `Summary` (`{ headline, asOf }`) from ticket 01,
  plus a claim-checked S3 artifact holding the fuller brief text.
- NestJS: a nightly `@nestjs/schedule` trigger enqueues with
  `trigger: 'system'`, `requestedBy: 'system'` — no `@RequiresJob` gate (this
  is free/anonymous-visible content, not a paid feature). Content-derived
  `jobId` keyed by date so re-enqueuing the same day collapses to the
  existing job (ADR-0007 §2 idempotency). Persist a thin result (headline +
  asOf + artifact pointer). Anonymous `GET` endpoint serves the latest brief
  (cache class 2).

## Acceptance criteria

- [ ] `generate-market-brief` added to `JobName` (additive) and wired
      through the Python worker's job dispatch (`handler.py`).
- [ ] Brief text visibly and clearly flags the underlying series as
      illustrative/synthetic.
- [ ] Nightly schedule enqueues with `trigger: 'system'`; the route carries
      no tier/`@RequiresJob` gate.
- [ ] Re-enqueuing within the same day reuses the same content-derived
      `jobId` (no duplicate job/artifact for the same day).
- [ ] Anonymous `GET` returns the latest brief's headline + asOf (and a way
      to reach the fuller artifact per the claim-check pattern).
- [ ] Unit lane (worker handler, no infra) and integration lane (JobBus
      round-trip, testcontainers) both green.

## Out of scope

- Announcement summaries, prospectus at-a-glance (tickets 03, 05).
- Any real (non-synthetic) price data — out of scope for the whole demo
  until the licensed-feed swap (spec's licence-boundary note).

## Resolution notes

- **No real LLM call** — kept the same ADR-0003 "no real analysis logic yet"
  scaffold posture `graph.py` established for TA/FA: `market_brief.py` is a
  deterministic narrative template over the real `GET /market/indices`
  fetch, not an LLM prompt. Headline + every narrated line routes through
  the "illustrative" framing (`ILLUSTRATIVE_NOTE`); the fallback when no
  index data is live yet also says so rather than going silent.
- **New `BackendClient`** (`services/ai/src/tuju_ai/backend_client.py`) is the
  worker's first outbound HTTP call to NestJS — a `Protocol` + `httpx`-backed
  impl, injected into `handle_job` (TA/FA ignore it; a `_UnusedBackendClient`
  test double asserts that). New `BACKEND_API_URL` env var
  (`.env.example`, `docker-compose.yml`'s `ai-worker` service).
  `services/ai/pyproject.toml` gained `httpx` as a base dependency.
- **jobId split, same pattern as TA/FA**: the BullMQ dedup id
  (`JobBus.deriveJobId`, TS) is `brief-{YYYY-MM-DD}`; the Python worker's own
  `JobResult.jobId` field is `brief:{YYYY-MM-DD}` (colon) — two independently
  computed, differently-formatted strings expressing the same date-bucketed
  idempotency, exactly mirroring the pre-existing `ta-`/`ta:` split. Mirrored
  named constants on both sides (`MARKET_BRIEF_JOB_ID_PREFIX` in
  `config.py`; a hand-synced `JOB_ID_PREFIX` const in `MarketBriefStore`) —
  there is no shared cross-language constant for this (same gap ticket 01
  flagged for the CJS/ESM boundary; noted here, not fixed, scope creep risk).
- **New `market_briefs` table + `MarketBriefStore`** (upsert on `briefDate`,
  ADR-0007 §2) subscribes to `JobBus.onResult` and filters by the `brief:`
  jobId prefix — every NestJS process importing `JobBusModule` sees every
  job family's results, so each store/subscriber self-filters (same posture
  `AnalysisResultStore` established for `isVerdictSummary`).
- **Class-2 cache added after review** (`GET /market-brief/latest`): the
  first pass skipped it (ticket text's parenthetical "(cache class 2)" read
  as minor); a spec-conformance review caught the gap since every sibling
  anonymous read surface (market, disclosures, screener, stocks) caches.
  Added a dedicated `BRIEF_CACHE_PREFIX`, deliberately NOT swept by the
  nightly-ingest/purge `READ_CACHE_PREFIXES` sweep (a fresh brief lands on
  its own JobBus cadence, unrelated to the nightly ingest transaction) —
  `MarketBriefStore` invalidates its one cached key itself, directly, the
  moment it persists.
- **Nightly schedule lives in `IngestionScheduler`**, not a new provider —
  the existing cron-isolation guarantee (`ingestion.cron-isolation.spec.ts`)
  already pins `ScheduleModule`/crons to the worker process only; adding a
  method there (rather than a sibling class) keeps that single source of
  truth. `WorkerModule`/`IngestionModule` gained a `JobBusModule` import
  (pure producer there; the API process stays the one subscriber/persister).
- **Test coverage**: `services/ai/tests/test_market_brief.py` (narrative
  composition, pure unit), `test_handler.py` additions (dispatch, jobId
  shape, bad-envelope terminal path), and
  `apps/backend/src/brief/market-brief.int.spec.ts` (testcontainers:
  JobBus → store → controller round trip, same-day upsert-in-place, and the
  class-2 cache's stale-read-until-invalidated behaviour) — unit + integration
  both green per the acceptance criteria.
