# Spec: announcements + news + corporate events (free-tier backend)

Type: grilling
Status: resolved
Blocked by: 10

## Question

With the domain model fixed ([Decide: the free-tier domain model](10-free-tier-domain-model.md)),
produce the handoff spec for the **disclosure/news/corporate-events** backend.

Decide (inside this spec):
- **Announcement categorisation:** the category taxonomy for the aggregator-snapshot
  Announcements (results, entitlements, dealings, etc.) and how the stock page/feed
  group them.
- **RSS news ticker-tagging:** how NewsArticle headlines are tagged to Companies
  (matching rule, ambiguity handling); headline+link only.
- **Corporate-actions calendar + quarterly-results calendar** endpoint shapes over
  CorporateAction and QuarterlyFinancials.
- **Substantial-shareholder/director dealings** feed (a subset of Announcements).
- Provenance: aggregator-snapshot rows carry the licence-boundary purge marker via
  lineage (ticket 10); reflect that in the read model.

## Notes

- Grilling ticket: consult `grilling` + `domain-modeling`; `to-spec` when writing.
- Announcement vs. News article distinction is already in the glossary.


## Answer

**A pure read projection over already-ingested Postgres, no JobBus** (same posture as
screener/ticket 12 and search+stock-page/ticket 11). Four read models over the fixed
ticket-10 entities — `Announcement`, `NewsArticle`, `CorporateAction`,
`QuarterlyFinancials` — plus the two calendars derived from them. All disclosure/news
rows are `aggregator`-class ingest (RSS news too, since we tag it ourselves), so the
whole area sits on the wrong side of the licence boundary and its rows are purged +
re-sourced from a licensed Bursa feed before any public exposure (decision B, ticket 10
lineage). No new entities; this spec pins categorisation, tagging, and endpoint shapes
only.

### 1. Announcement categorisation

The exact Bursa taxonomy is **`[UNVERIFIED]`** (Bursa's site 403s all automated access,
research 02), so we do **not** try to mirror Bursa's internal codes. Instead we define a
**stable internal `AnnouncementCategory` enum** and the aggregator adapter maps its
scraped/snapshot labels onto it. The enum is the contract every consumer (stock-page
feed, dealings feed, results calendar) agrees on; the mapping table lives in the adapter
so a later licensed Bursa feed re-maps to the **same** enum with no consumer change.

Enum (derived from research 02's observed aggregator sections + Bursa families):

- `FINANCIAL_RESULTS` — quarterly/annual reports (the results-calendar source).
- `ENTITLEMENT` — dividends, bonus, rights, splits (co-emitted as `CorporateAction`s, see §3).
- `SHAREHOLDING_CHANGE` — substantial-shareholder + director/insider dealings (the dealings feed, §4).
- `GENERAL` — general announcements.
- `ADDITIONAL_LISTING` — additional/quoted securities.
- `MEETING` — AGM/EGM notices.
- `CIRCULAR` — circulars to shareholders.
- `ANNUAL_REPORT` — annual report availability.
- `LISTING` — IPO/listing-related (the demo IPO calendar itself stays curated `IpoListing`, ticket 10; this only tags a company's own listing-related disclosures).
- `OTHER` — the adapter's fallback for any label it can't confidently map (never silently drop a row).

Each `Announcement` carries: `company` (FK), `category` (enum above), `title` (the filed
headline, a public fact), `filedAt` (timestamp), `sourceUrl` (link back to the
disclosure), `ingestionRunId` (provenance). **Attachment bodies are not ingested** —
Bursa detail/attachment hosts 403 (research 02) and the demo needs only the list-level
facts. **Grouping:** the stock-page feed and the market-wide feed group by `category`
for filtering; default order is `filedAt` desc. The client filters by one-or-more
categories via query param; no server-side "grouped" payload (flat rows + category field
is enough and paginates cleanly).

**AI-summary field (owned here, referenced by ticket 11):** `Announcement` carries an
optional `aiSummary` (nullable text) + `aiSummaryAsOf`. This is the ticket-05 "announcement
summaries" shallow showcase artifact's landing field — populated by the ticket-05
system-caller path (`trigger: 'system'`, ticket 09) over the **demo-only aggregator
snapshot**, null until generated, and it inherits the announcement row's `aggregator`
provenance (so the summary is labelled illustrative/demo-only and purged with its row).
This spec owns the *field on the read model*; the *generation job* is ticket 05/09's.

### 2. RSS news ticker-tagging

`NewsArticle` = **headline + link + source + publishedAt only** (research 02; no body
text, lowest licence risk). General RSS is **not** ticker-tagged, so we tag in-house:

- **Matching rule:** case-insensitive match of the headline against a per-`Company`
  alias set = { `shortName`, `fullName`, and a small curated alias list on the company
  (e.g. "Maybank" → Malayan Banking) }. Match on `shortName`/alias primarily; `fullName`
  is often absent from headlines. A single article may tag **multiple** companies
  (many-to-many `NewsArticle ↔ Company` join, `NewsArticleTag`), each tag carrying the
  matched alias for auditability.
- **Ambiguity handling:** matching is **conservative — tag only on a confident whole-word
  alias hit.** No fuzzy/substring matching (avoids "CIMB" matching inside unrelated
  words, or short 2–3 letter shortNames over-matching). An article that matches nothing
  is still stored as **market-level news** (company tags empty) — it surfaces in the
  market-overview/market news feed, not on any stock page. Ambiguous multi-company hits
  are all tagged (union), not dropped; the demo tolerates a slightly noisy tag over a
  missed one. Tagging is a deterministic step in the RSS ingest cadence (ticket 07's
  15–30-min RSS poll), **not** an AI job.
- Provenance: `NewsArticle` is `aggregator`-class (we compile third-party headlines);
  purged at the licence boundary like announcements.

### 3. Corporate-actions calendar + quarterly-results calendar

Two calendar endpoints, both plain SQL projections; **no new entity** — they read
`CorporateAction` and `QuarterlyFinancials` (ticket 10) respectively.

- **Corporate-actions calendar** over `CorporateAction` (dividend/bonus/split/rights).
  A row exposes the entitlement's key dates (`exDate`, `entitlementDate`, `paymentDate`
  where present — research 02 confirms i3investor carries all three for dividends),
  `type`, per-share `amount`/`ratio`, `company`, `announcedAt`, provenance. **`exDate`
  is the primary calendar axis** (the date the market cares about); nullable
  payment/entitlement dates are tolerated (bonus/rights may lack a payment amount).
  `GET /calendar/corporate-actions?from&to&type&companyCode` — date-window (default =
  next 30 days forward + 7 back), optional `type` and `companyCode` filters, ordered by
  `exDate`. Dividends here are the **same rows** DY reads (ticket 10), single source.
- **Quarterly-results calendar** over `QuarterlyFinancials`. Because research 02 found
  **no confirmed forward earnings calendar for KLSE**, this calendar is **backward-
  looking = when results were *filed*** (the `FINANCIAL_RESULTS` announcement's `filedAt`
  / the quarter's reported date), **not** a forward "expected results" calendar. A row =
  `company`, `fiscalQuarter`, `reportedAt`, and a link to the underlying
  `FINANCIAL_RESULTS` `Announcement`. `GET /calendar/results?from&to&companyCode`,
  ordered by `reportedAt` desc. **Forward earnings-date estimation is out of scope /
  fog** (no licensed source; would need a vendor earnings calendar — ties to
  architecture ticket 10). Stated explicitly so `to-spec` doesn't infer a forward
  calendar.

### 4. Substantial-shareholder / director dealings feed

**Not a new entity — a filtered view of `Announcement` where `category =
SHAREHOLDING_CHANGE`.** Research 02 confirms the aggregator (i3investor Insider section)
carries these as list rows but **field depth is `[UNVERIFIED]`**, so the demo feed
exposes only what's reliably present at list level: `company`, `filedAt`, `title` (which
carries the "who / bought|sold / how much" gist as filed), `sourceUrl`, provenance.
**Structured buyer/seller/volume/price fields are deferred** (parsing them reliably needs
the licensed Bursa structured form, not the aggregator list) — noted as fog, not
attempted from the snapshot. `GET /disclosures/dealings?companyCode&from&to&limit&offset`,
ordered `filedAt` desc; also reachable via the general announcements feed filtered to the
`SHAREHOLDING_CHANGE` category (same rows, one read model).

### 5. Provenance in the read model

Every row in all four models carries `ingestionRunId` (ticket 10 lineage); reads join to
`IngestionRun` for the provenance class → **all disclosure/news is `aggregator`**, so the
whole area renders with the demo-only/illustrative label and is the primary target of the
decision-B purge (delete rows whose run belongs to an aggregator adapter; re-source from
a licensed Bursa feed before public exposure). Announcements' optional `aiSummary`
inherits its row's `aggregator` provenance (§1). **No per-row `source` column** —
consistent with ticket 10.

### Endpoints (all anonymous, all class-2 cache)

- `GET /companies/:code/announcements?category&limit&offset` — stock-page feed (this is
  ticket 11's `GET /stocks/:code/announcements`, scoped to one company).
- `GET /announcements?category&companyCode&from&to&limit&offset` — market-wide feed.
- `GET /disclosures/dealings?companyCode&from&to&limit&offset` — §4 (view of the above).
- `GET /companies/:code/corporate-actions?type&limit&offset` — ticket 11's
  `GET /stocks/:code/corporate-actions`, scoped to one company.
- `GET /calendar/corporate-actions?from&to&type&companyCode` — §3.
- `GET /calendar/results?from&to&companyCode` — §3.
- `GET /news?companyCode&limit&offset` — tagged news feed; `companyCode` omitted =
  market-level news.

**Cache = ADR-0004 class 2** (EOD/snapshot-derived aggregated views, keyed by normalised
params, invalidated on the disclosure/RSS ingest cadence, not intraday). Default
`limit` 50, max 100, with total count, mirroring ticket 12's pagination convention.

### Scope boundaries recorded

- **Forward earnings/results calendar** — out of scope / fog (no licensed forward source).
- **Structured dealings fields** (buyer, volume, price) — fog (needs licensed structured feed).
- **Announcement attachment bodies** — not ingested (Bursa detail hosts 403).
- **Announcement AI summarisation *job*** — owned by tickets 05/09; this spec only lands the field.
- **IPO calendar itself** — `IpoListing` is curated (ticket 10); untouched here beyond the `LISTING` announcement category tag.

### Model / glossary additions

Small, additive to ticket 10's model (ticket 10 stays closed; this spec owns the
additions for `to-spec` to fold in):

- `AnnouncementCategory` enum (the 10 values above) + `Announcement.category`,
  `Announcement.aiSummary`/`aiSummaryAsOf`, `Announcement.sourceUrl`.
- `NewsArticleTag` (`NewsArticle ↔ Company` many-to-many, carries matched alias);
  `Company.aliases` (curated alias list feeding the tagging rule).
- Two derived calendars (no entity) — corporate-actions (over `CorporateAction`) and
  results (over `QuarterlyFinancials`).

No new fog toward the destination beyond the two boundaries above (both already implied
by research 02's `[UNVERIFIED]`s and both pointing at the licensed-feed / architecture
ticket 10). No ticket invalidated. Ready for `to-spec`.
