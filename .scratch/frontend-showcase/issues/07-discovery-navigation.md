# 07 — Integrate analysis discovery and focused navigation

Status: resolved
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

## Resolution — 2026-10-16

Market discovery publishes only the verified local canary: MAYBANK (`1155`) and
Insights Analytics Berhad (`094fd734-c812-4bcf-921d-72dea6f21fb6`). Their IDs are
the only values in the frontend discovery configuration. The stock has readable
identity and coherent ready TA/FA artifacts; the prospectus summary/artifact pair
passed contract validation. The source is Part 1 only, so the reader must preserve
the limitation recorded in the readiness evidence.

This deliberately provides the verified one-stock/one-prospectus journey and does
not claim the original target of three stocks and two prospectuses is met. The
broader target and any additional example selection remain a readiness shortfall.
Discovery previews read only stock identity, TA/FA envelopes, and the prospectus
summary; rich artifacts remain on their detail pages. Primary navigation is
Market-only; search and the hidden routes remain available.
