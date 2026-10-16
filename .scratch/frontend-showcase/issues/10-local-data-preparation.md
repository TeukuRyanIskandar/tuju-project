# 10 — Prepare local showcase data and re-audit coverage

Status: needs-info
Type: task
Blocked by: 14 (generation readiness), market/news decisions (11, 13), operator acceptance/rights review

## Goal and evidence

Unblock ticket 01 without frontend mocks or a backend rewrite. The 2026-10-15
[readiness audit](../readiness.md) found a healthy, freshly migrated local API but
zero market/stock/IPO/analysis data. No stock or prospectus meets minimum coverage.
This is a data-preparation gap, not an established endpoint implementation defect.

## Scope

- Confirm whether an existing prepared Tuju environment/data backup is available
  before generating new results. Do not point at unrelated project databases.
- Obtain explicit approval for reference/data writes, external data fetches,
  corpus upload and any LLM jobs/budget. Confirm private/non-redistribution limits.
- Inspect effective runtime adapter/source settings. Existing default Compose
  startup alone is not proof that yfinance is configured for stock preparation.
- Agree how market panels coexist with the KLCI real-data pipeline. Inspect the
  bound index adapter and constituent coverage; do not seed synthetic prices over
  real stock data merely to fill boards. File a scoped follow-up if no safe
  supported coexistence path exists.
- Use existing worker CLI preparation paths listed in `../readiness.md` only
  after approval. Keep workers off until job execution is intentionally approved.
  Do not reset/purge the database, overwrite unrelated data or deploy changes.
- Re-run ticket 01's read-only audit, then choose up to three complete stocks and
  two prospectuses from actual responses (minimum one complete example each).

## Acceptance criteria

- Market headline/history, movers and sectors have measured coverage, dates and
  honest source classes, or explicit remaining blockers.
- At least one stock has readable EOD series, TA/FA envelopes and matching rich
  artifacts; target three. Record missing metrics and facts-only/stale output.
- At least one prospectus has coherent summary and rich artifact; target two.
  Record actual IDs, generation dates and extraction limitations.
- Supporting news empty/error states are recorded independently.
- `../readiness.md` contains new endpoint evidence and selected IDs; no fixtures
  are substituted and no official/live timestamp claims are invented.

## Verification

Read-only API re-audit after approved preparation, plus operator review. Budget
and data-rights approval are prerequisites, not implied by local startup approval.

## Comments

### 2026-10-15 — Raw inputs prepared; generation still gated

Operator approved local data preparation. Full yfinance ingest populated index/
reference/disclosure/news snapshots but first hit an installed-client period2
validation failure. Added explicit request end dates with regression assertions;
rebuilt backend and retried `ingest-klci`: 21,859 bars, 173 quarters, 30 fundamentals
and 30 indicator snapshots, zero fetch failures. Backend 432 tests/typecheck/build
passed. Seeded 3 curated Part-1 PDFs/listings after creating the missing local
bucket. No resets/purges or fake stock results.

115 jobs (55 announcement + 60 TA/FA) wait with workers off; prospectus analysis
has not been enqueued. Configured OpenRouter key exists and model is
`openrouter/free`, but no AI calls executed. Explicit execution approval and
artifact re-audit remain. Tickets 11–13 cover confirmed market/news/bootstrap
gaps. Details/real candidate IDs are in `../readiness.md`. Keep `needs-info` until
the completed-analysis and operator acceptance gates are met.

### 2026-10-15 — Free-model execution approved and attempted, not complete

Approval supersedes the earlier generation gate. Verified the requested two
listing IDs/PDF prerequisites, enqueued each once, built and started only AI
using configured `openrouter/free`. No paid fallback, application edits,
force re-enqueue, purge/reset or resident ingestion. After bounded monitoring
06:42–06:56 UTC, stopped AI gracefully (exit 0) for repeated terminal invalid
LLM output. 59 completed: 55 announcements and 4 facts-only analyses; 9 failed;
49 waiting: 47 TA/FA and both prospectuses; 0 active/delayed. Queue preserved.

06:57 API audit still meets neither minimum: 0 complete stocks, 0 prospectuses.
1155 remains pending; 1023 failed both; 5326 TA facts_only/FA failed. Readable
5326 TA also violates ISO timestamp wire contracts, confirmed twice after the
first audit. Both requested prospectus summary/artifact pairs are 404 (jobs
waiting, not generation failures); Part-1-only source limitation remains.
See latest `../readiness.md` evidence and ticket 14 for scoped diagnosis requiring
coordinator approval. Do not mark this ticket complete or restart remaining jobs
without a deliberate next execution decision. Tickets 11/13 remain outstanding.
