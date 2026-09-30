# Spec: Free-tier announcements + news + corporate events (backend)

Status: ready-for-agent

> Handoff spec produced by `to-spec` from the free-tier wayfinder map. Source
> decision: [announcements + news + events spec](../free-tier/issues/13-announcements-news-events-spec.md).
> **Depends on** [Spec 01: data ingestion + domain model](01-data-ingestion-and-domain-model.md).
> **Provides** the read model that [Spec 02: search + stock page](02-search-and-stock-page.md)
> consumes for its per-company disclosure/action lists.

## Problem Statement

The demo needs to surface company disclosures (announcements), corporate events
(dividends, bonuses, splits, rights), substantial-shareholder/director dealings, a
corporate-actions calendar, a results calendar, and ticker-tagged news headlines. The
sources are unlicensed aggregators and general RSS (Bursa's own site 403s all
automated access), so everything here is demo-only and must be purgeable at the licence
boundary. There is no disclosure/news backend yet.

## Solution

Four read models over the already-ingested Postgres (no JobBus) — `Announcement`,
`NewsArticle`, `CorporateAction`, `QuarterlyFinancials` — plus two derived calendars.
Announcements are classified onto a **stable internal category enum** the source
adapter maps onto (so a later licensed feed re-maps to the same enum). News is
headline+link only, tagged to companies in-house by a conservative alias match. All
rows are `aggregator`-class and are the primary target of the decision-B purge.

## User Stories

1. As a user, I want a company's announcements grouped by category (results,
   entitlements, dealings, etc.), so that I can find the disclosure type I care about.
2. As a user, I want a market-wide announcements feed filterable by category and date,
   so that I can scan recent disclosures across the market.
3. As a user, I want a substantial-shareholder / director dealings feed, so that I can
   watch insider activity.
4. As a user, I want a corporate-actions calendar keyed on ex-date, so that I can plan
   around dividends, bonuses, splits, and rights.
5. As a user, I want a results calendar showing when companies filed quarterly results,
   so that I can track reporting.
6. As a user, I want news headlines tagged to the company I'm viewing, so that I see
   relevant coverage; and market-level news when nothing matches.
7. As a user, I want each disclosure/news row labelled demo-only/illustrative, so that I
   understand its provenance.
8. As the platform operator, I want all these rows purgeable via ingestion-run lineage,
   so that I can cross the licence boundary before any public exposure.
9. As the AI showcase (spec 06), I want an announcement to carry an optional AI-summary
   field, so that the announcement-summaries artifact has somewhere to land.

## Implementation Decisions

Posture: **pure read projection over ingested Postgres, no JobBus.** All rows are
`aggregator`-class (RSS news too — we tag it ourselves), so the whole area is on the
wrong side of the licence boundary and is purged + re-sourced from a licensed Bursa
feed before public exposure (decision B, spec-01 lineage). No new core entities beyond
the additive fields below.

### 1. Announcement categorisation

Bursa's exact taxonomy is unreadable (site 403s), so define a **stable internal
`AnnouncementCategory` enum**; the aggregator adapter maps its scraped labels onto it,
and a later licensed feed re-maps to the **same** enum with no consumer change.

Enum: `FINANCIAL_RESULTS`, `ENTITLEMENT`, `SHAREHOLDING_CHANGE`, `GENERAL`,
`ADDITIONAL_LISTING`, `MEETING`, `CIRCULAR`, `ANNUAL_REPORT`, `LISTING`, `OTHER`
(the adapter's fallback — never silently drop a row).

Each `Announcement`: `company` FK, `category`, `title` (filed headline — a public
fact), `filedAt`, `sourceUrl`, `ingestionRunId`. **No attachment bodies** (Bursa detail
hosts 403). Stock-page feed and market feed group by `category`; default order
`filedAt` desc; client filters by one-or-more categories (flat rows + category field,
no server-side grouped payload).

**AI-summary field (owned here, referenced by spec 02 and spec 06):** `Announcement`
carries optional `aiSummary` (nullable text) + `aiSummaryAsOf`. Populated by spec-06's
system-caller path over the demo-only aggregator snapshot; null until generated;
inherits the row's `aggregator` provenance. This spec owns the *field*; the *generation
job* is spec 06's.

### 2. RSS news ticker-tagging

`NewsArticle` = headline + link + source + `publishedAt` only (no body). Tagged in-house:
- **Matching rule:** case-insensitive whole-word match of the headline against a
  per-`Company` alias set = `shortName`, `fullName`, and a curated `aliases` list
  (spec 01). Match primarily on `shortName`/alias.
- A `NewsArticleTag` M2M records each `NewsArticle ↔ Company` tag with the matched alias
  (auditability). One article may tag multiple companies.
- **Ambiguity:** conservative — tag only on a confident whole-word hit. No
  fuzzy/substring matching (avoids short shortNames over-matching). No match → stored as
  **market-level news** (empty tags), surfaced in the market news feed, not on a stock
  page. Multi-company hits are all tagged (union), not dropped.
- Tagging is a deterministic step in the RSS ingest cadence (spec-01 15–30-min poll),
  **not** an AI job. `aggregator`-class; purged at the licence boundary.

### 3. Calendars (derived, no new entity)

- **Corporate-actions calendar** over `CorporateAction`. Row: key dates (`exDate`,
  `entitlementDate`, `paymentDate` where present), `type`, per-share `amount`/`ratio`,
  `company`, `announcedAt`, provenance. **`exDate` is the primary axis**; nullable
  payment/entitlement dates tolerated. Dividends here are the same rows DY reads
  (single source). `GET /calendar/corporate-actions?from&to&type&companyCode` (default
  window = next 30 days + 7 back), ordered by `exDate`.
- **Quarterly-results calendar** over `QuarterlyFinancials`. **Backward-looking = when
  results were filed** (no confirmed forward earnings source for KLSE). Row: `company`,
  `fiscalQuarter`, `reportedAt`, link to the underlying `FINANCIAL_RESULTS`
  `Announcement`. `GET /calendar/results?from&to&companyCode`, ordered `reportedAt` desc.
  **Forward earnings-date estimation is out of scope** (needs a licensed source).

### 4. Substantial-shareholder / director dealings feed

**Not a new entity — a filtered view of `Announcement` where
`category = SHAREHOLDING_CHANGE`.** Aggregator field depth is unverified, so the demo
feed exposes only reliably-present list-level fields: `company`, `filedAt`, `title` (the
"who / bought|sold / how much" gist as filed), `sourceUrl`, provenance. **Structured
buyer/seller/volume/price fields deferred** (need the licensed Bursa structured form).
`GET /disclosures/dealings?companyCode&from&to&limit&offset`, ordered `filedAt` desc;
also reachable via the general feed filtered to `SHAREHOLDING_CHANGE` (same rows).

### 5. Provenance

Every row carries `ingestionRunId` (spec-01 lineage); reads join to `IngestionRun` →
all disclosure/news is `aggregator`, rendered demo-only/illustrative and the primary
decision-B purge target. `Announcement.aiSummary` inherits its row's provenance. No
per-row `source` column.

### Endpoints (all anonymous, all class-2 cache)

- `GET /companies/:code/announcements?category&limit&offset` — spec-02's per-company feed.
- `GET /announcements?category&companyCode&from&to&limit&offset` — market-wide feed.
- `GET /disclosures/dealings?companyCode&from&to&limit&offset` — §4 (view of the above).
- `GET /companies/:code/corporate-actions?type&limit&offset` — spec-02's per-company list.
- `GET /calendar/corporate-actions?from&to&type&companyCode` — §3.
- `GET /calendar/results?from&to&companyCode` — §3.
- `GET /news?companyCode&limit&offset` — tagged feed; `companyCode` omitted = market news.

Cache = **class 2**, keyed by normalised params, invalidated on the disclosure/RSS
ingest cadence (not intraday). Default `limit` 50, max 100, with total count.

### Model additions (additive to spec 01)

`AnnouncementCategory` enum + `Announcement.category`/`aiSummary`/`aiSummaryAsOf`/
`sourceUrl`; `NewsArticleTag` (M2M, matched alias); `Company.aliases`; two derived
calendars (no entity).

## Testing Decisions

- **Good test = external behaviour** (which rows a feed/calendar returns, category
  grouping, tagging results), not adapter internals.
- **Categorisation tests:** adapter label → enum mapping (incl. unknown → `OTHER`).
- **Tagging tests:** headline "Maybank posts record profit" tags Malayan Banking via
  alias; short/fuzzy non-matches rejected; multi-company headline tags all; no-match →
  market-level.
- **Calendar tests:** corporate-actions ordered by `exDate` with the default window;
  results calendar backward-looking, linked to the results announcement.
- **Dealings view test:** `SHAREHOLDING_CHANGE` rows appear in both the general feed
  (filtered) and the dealings endpoint.
- **Provenance/purge test:** all rows `aggregator`; the decision-B purge removes them.
- **Integration** via testcontainers Postgres (ADR-0011).
- Prior art: `apps/backend` controller/integration tests.

## Out of Scope

- **Forward earnings/results calendar** — no licensed forward KLSE source (still fog).
- **Structured dealings fields** (buyer, volume, price) — need a licensed structured
  feed (still fog).
- **Announcement attachment bodies** — not ingested (Bursa detail 403).
- **Announcement AI-summarisation *job*** — owned by spec 06; this spec lands the field.
- **IPO calendar itself** — `IpoListing` is curated (spec 01); untouched beyond the
  `LISTING` category tag.
- **Anonymous rate-limit / abuse posture** — cross-cutting open question.

## Further Notes

- No new ADR flagged by this spec. Uses spec-01's model and lineage.
- Terms (`Announcement category`, `News article tag`) are in `apps/backend/CONTEXT.md`.
