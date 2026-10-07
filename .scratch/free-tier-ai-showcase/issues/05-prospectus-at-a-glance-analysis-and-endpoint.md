# Build ticket: Prospectus at-a-glance — LLM analysis + job + read endpoint

Type: task
Status: resolved (box 2 pending live-LLM run; needs operator's OpenRouter key)
Blocked by: 01 (`system` trigger + verdict-less `Summary`), 04 (parse + section router)

> Ticket 05 of the spec-06 execution effort — the flagship artifact. Fixed
> inputs: decision ticket 09's answer (`.scratch/free-tier/issues/09-
> prospectus-at-a-glance.md`) for the five sections, the two Bursa insights,
> the output contract, and the ~$2/doc cost ceiling. ADR-0004/0007 (claim-
> check pattern, additive job names). This is the only showcase artifact on
> real, licence-safe data (`source: real` provenance) — no synthetic prices,
> no aggregator snapshot.

## What to build

The flagship artifact end-to-end: enqueue analysis for a curated IPO's
prospectus, get back the five-section at-a-glance + two Bursa insights,
readable anonymously.

- New BullMQ job `analyze-prospectus` (additive `JobName`) on the `analysis`
  queue, payload `ProspectusPayload = { prospectusId }` (the `IpoListing.id`
  — the worker fetches the IPO reference row via a NestJS read API and the
  stored PDF from S3; stateless per ADR-0004).
- Per-section long-context LLM prompting (with prompt caching over the
  shared document/system prefix) against ticket 04's routed sections:
  offer, business, financials trend, risk factors (ranked/themed). Section 5
  ("what-to-watch") is a **reduce** over the other four, not its own
  independent prompt. Start on Gemini 2.5 Flash; the Pro/Claude Sonnet A/B
  on financials + risk-ranking is a build-time quality check, not a blocker.
- Two Bursa-specific insights, both on clean data: Shariah status (read from
  the existing `ShariahStatus` data) and cornerstone investors (extracted
  from the prospectus text itself).
- Assemble the five sections + two insights into one opaque rich JSON
  artifact, claim-checked to S3. Emit the ticket-01 verdict-less `Summary`
  (`{ headline, asOf }`, headline = the what-to-watch line) with provenance
  `source: real`.
- NestJS: a system-triggered enqueue path for curated IPO rows (an ops/admin
  action over `IpoListing` rows that have a `prospectusS3Key` and no
  analysis yet — this is a handful of manually-curated rows, not a
  continuous feed) using `trigger: 'system'`, `requestedBy: 'system'`.
  Persist a thin result row keyed by `prospectusId`, joined to the
  `IpoListing` row. Anonymous `GET` read endpoint returns the summary +
  artifact pointer for a given prospectus/IPO.
- Cost guard: a build-time check asserting per-doc token usage stays under
  the ~$2/doc ceiling.

## Acceptance criteria

- [x] `analyze-prospectus` added to `JobName` (additive); `ProspectusPayload`
      added to the contract payloads and wired through envelope validation.
- [ ] Running the job against each of the 3 real corpus PDFs produces all 5
      sections + both Bursa insights in the artifact.
- [x] The wire summary is verdict-less (`{ headline, asOf }`, no `verdict`
      field) with `source: real` provenance.
- [x] Re-running reuses ticket 04's persisted parse (near-free re-run — no
      re-parse of the underlying PDF).
- [x] Anonymous `GET` endpoint returns the summary/artifact pointer keyed by
      `prospectusId`, joined to the `IpoListing` row.
- [x] A build-time cost-guard check exists asserting the per-doc token
      budget stays under the ceiling.
- [x] Unit lane (section-router + reduce assertions, no infra) and
      integration lane (JobBus round-trip, testcontainers) both green, per
      spec 06's Testing Decisions.

## Out of scope

- Peer valuation insight — deferred per the spec (rests on synthetic prices,
  would undercut the "real clean data" premise of this artifact).
- Automated prospectus fetching, paid TA/FA features, RAPTOR/contextual
  retrieval/vector store, user-triggered AI jobs — all explicitly out of
  scope for spec 06.

## Answer

Shipped in `610258b` (contract + Python worker) and `fe9964f` (NestJS). See
`map.md` and ADR-0013 for the full shapes.

Verified with `FakeLLMClient` only: Python unit lane 108 passed, integration
lane 2 passed (Redis + LocalStack round trip), contracts vitest 17 passed,
backend unit 425 passed, backend integration 25 passed.

**Still open (needs the operator's OpenRouter key, so acceptance boxes 2 and
the live part of the cost check are not ticked):** run the job on the 3 real
PDFs with a live model; confirm OpenRouter `response_format`, `usage.include`
and `cache_control` behaviour; Flash vs Pro/Sonnet A/B. The 3 opt-in
`-m corpus` prospectus tests (full pipeline, real PDF, fake LLM) were
collected but not run (slow).
