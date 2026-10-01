# Ticket 02 — Market feed, dealings view, calendars, news feed + per-company filters

Effort: free-tier-disclosures (spec 04). Type: task. Status: resolved.
Blocked by: 01 (resolved).

Spec: `.scratch/free-tier-specs/04-announcements-news-corporate-events.md`
"Endpoints", §3 (calendars), §4 (dealings view).

## Scope

The read half of spec 04 — a new `src/disclosures/` module (anonymous,
class-2-cached under `cache:disclosures:`, keyed by normalised params) plus the
category/type filters on the existing spec-02 per-company stock-page lists:

- `GET /announcements?category&companyCode&from&to&limit&offset` — market-wide
  feed, `filedAt` desc, flat rows + category field (no server-side grouping).
- `GET /disclosures/dealings?companyCode&from&to&limit&offset` — the
  substantial-shareholder/director-dealings feed: a filtered view of the same
  `Announcement` rows where `category = SHAREHOLDING_CHANGE` (same rows as the
  general feed filtered to that category).
- `GET /calendar/corporate-actions?from&to&type&companyCode` — derived calendar
  over `CorporateAction`, `exDate` the primary axis, default window = next 30
  days + 7 back, ordered `exDate`.
- `GET /calendar/results?from&to&companyCode` — backward-looking when-filed
  calendar over `QuarterlyFinancials` ⋈ the company's `FINANCIAL_RESULTS`
  `Announcement`, ordered `reportedAt` desc. Forward estimation out of scope.
- `GET /news?companyCode&limit&offset` — tagged feed; `companyCode` omitted =
  market-level news (articles with **no** tags).
- Extended spec-02 routes: `/stocks/:code/announcements?category` (one-or-more,
  comma-separated) and `/stocks/:code/corporate-actions?type`; per-item
  `aiSummaryAsOf` on the announcement rows.

Pagination policy follows ticket-03 prior art (clamp, never 400; default 50,
max 100, with total). Unknown `companyCode` in a filter position → empty page
(filter semantics, not a 404 resource lookup). Dealings/calendar/news ordering
gets deterministic `id` tiebreakers.

## Out of scope

Structured dealings fields, announcement attachment bodies, forward earnings
estimation, the AI-summary job, anonymous rate-limiting.

## Answer

Done in the working tree; verified (typecheck clean, unit lane green, new
`disclosures.int.spec.ts` green on the testcontainers lane). See map decisions
for the per-company-route and results-linkage calls.
