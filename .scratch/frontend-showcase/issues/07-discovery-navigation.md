# 07 — Integrate analysis discovery and focused navigation

Status: ready-for-agent
Type: task
Blocked by: 01, 03, 05, 06

## Goal

Connect the market and both analysis journeys without a separate demo landing.

## Work

- Add prominent automatic-stock-analysis/prospectus panels to market home.
- One identifier-only configuration module uses examples verified in ticket 01;
  target 3 stocks/2 prospectuses, minimum one usable of each documented.
- Read stock identity/TA/FA envelopes and prospectus summaries for previews; do not
  prefetch all rich artifacts. Use response names/headlines/status/dates.
- Keep Market home and search. Hide unfinished dashboard destinations from
  primary navigation, retaining their routes/code. All detail pages link back.
- Explain curated coverage vs broader search/movers and precomputed automation.

## Acceptance criteria

- From home, a visitor can reach working stock/prospectus examples without IDs.
- Missing example is locally unavailable/retryable, not silently replaced by mocks.
- Preview requests are thin reads, never enqueue jobs; result copy is API-backed.
- Search remains usable and non-covered stocks have honest analysis-unavailable
  treatment rather than an implied promise of universal analysis.
- Active navigation and return links are correct on direct links and reloads.

## Verification

Component/navigation tests, request assertions and direct route checks. Confirm
configured IDs against readiness evidence; no tokens/URLs/results in config.
