# Spec: Frontend showcase — market overview, automatic TA/FA and prospectus

Status: ready-for-agent

## Objective and agreed scope

Build a private, presenter-led showcase that also supports light exploration.
The home is a **functional market overview**, not a demo-selection landing page.
From it, visitors can investigate automatic technical/fundamental analysis and
prospectus at a glance. Analysis is system-precomputed: opening or refreshing a
page never submits a job.

Three screens:

1. `/`: market overview with analysis and prospectus discovery panels.
2. `/stocks/$code`: identity, EOD chart, TA, FA and supporting news.
3. `/ipo/$prospectusId`: structured prospectus overview and detail.

This explicitly supersedes the prospectus exclusion in
[`poc-phase-a/spec.md`](../poc-phase-a/spec.md), while retaining its private-data,
descriptive-analysis and system-precompute policies. Backend/worker readiness is
supported by code inspection, **not yet verified against a live deployment**.

## Sources and existing foundation

- Read `CONTEXT-MAP.md` and each affected workspace's `CONTEXT.md` before work.
- Follow `apps/frontend/DESIGN.md`: dense, dark terminal, tabular numbers,
  restrained accent, visible provenance; no visual-system redesign.
- Existing shell, search, shared panels/states/formatters, `apiGet` and TanStack
  Query infrastructure should be reused. All three page routes are placeholders.
- Existing FE market queries cover indices, index history, movers and sectors.
- Existing IPO queries cover thin summary and rich artifact. Stock queries need
  series, analysis-envelope and browser-artifact additions.
- HTTP and artifact schemas belong to `packages/contracts`, not component-local
  response types. No browser access to S3 buckets or worker-facing reference APIs.

## Demonstration and success criteria

1. Open the market overview; explain market conditions using sourced panels.
2. Select a prepared stock from its automatic-analysis panel.
3. Inspect EOD history, TA and FA; distinguish code-computed facts from AI wording.
4. Return to market and select a prepared prospectus.
5. Review business, offer, financials, risks and what to watch; expand insights.

Success means both capabilities are reachable without typing detail URLs, results
are backed by actual APIs, failures remain local to panels, and freshness/source
limitations are explicit. No recommendations, fabricated results or analysis jobs
are required to complete the journey.

## Screen 1: Market overview

### Layout and content

- Market snapshot at the top: headline index name, level, change and history chart.
- Movers and sectors in the primary dashboard area.
- Prominent automatic-stock-analysis and prospectus preview panels below/beside
  the market panels, not buried in another destination.
- Header retains `Market` as home and existing stock search. Hide unfinished
  screener/announcement/calendar/news destinations from primary navigation for
  this milestone; retain their routes and code. Detail pages link back to market.

### Market snapshot

- Select the headline index by `kind`, never by a hardcoded UUID or assumed name.
- Display backend identity/provenance; never relabel a synthetic analogue as an
  official live Bursa index. Show level/change, with null change unavailable.
- History uses `/market/indices/:id/series`; default `1m`, optional `3m`/`1y`
  controls use supported API ranges. Show date/value inspection and table fallback.
- The current index/sector HTTP contracts do **not** carry quote timestamps;
  movers have lineage metadata but not necessarily a quote timestamp. A chart's
  latest date is a **history date**, and client fetch time is **retrieval time**,
  neither proves current quote time. Show `Quote time unavailable` where needed;
  do not claim real-time freshness. Adding quote-time contracts is follow-up work
  unless readiness review finds the lack blocks an honest demonstration.

### Movers and sectors

- Gainers/losers/most-active tabs; default gainers, limit 10 per board.
- Rows show code/name, price, signed percentage change and volume; stock rows link
  to stock detail. Volume is not a price-change chip.
- Sector board displays supplied sector name, level, signed change and provenance.
- Independent loading/error/empty handling for snapshot/history/movers/sectors.

### Analysis and prospectus discovery

- Small curated set: target three stocks and two prospectuses, with at least one
  fully usable example of each capability required for acceptance.
- One configuration module holds stable identifiers and optional editorial order.
  Stock/company names, headlines and availability come from backend responses;
  configuration must not become a second store of results or credentials.
- Stock previews read identity and TA/FA envelopes; prospectus previews read thin
  summaries. Do not download every rich artifact on the home page.
- Identify system-precomputed output and show returned analysis dates/status.
- Missing examples remain locally unavailable with retry; do not silently insert
  fake content. Final example IDs are selected by readiness/rehearsal, not guessed.
- Search/movers can reach stocks outside analysis coverage; discovery does not
  promise TA/FA for every stock.

## Screen 2: Stock detail

### Composition

- Full-width identity header, EOD chart, side-by-side TA/FA panels on desktop,
  compact company-scoped news beneath. Stack at narrow widths.
- Header shows company/code/sector/board where supplied. Latest EOD close/date
  comes from series, or clearly distinguished snapshot data if series fails.
- Identity/core failure must not swallow otherwise usable panel reads; unknown
  stock versus unsupported analysis must be distinguishable in presentation.
- Market data can exist outside KLCI-30 TA/FA coverage. An analysis endpoint 404
  becomes local `Automatic analysis unavailable`, not a whole-page stock 404.

### Chart

- `/stocks/:code/series?interval=1d&range=2y`; daily close-price line and volume.
- Default visible window 1Y; 1M/3M/1Y/2Y controls filter fetched bars locally.
- Inspect date/price/volume, show latest stored date, provide accessible table.
- Convert numeric strings only at the chart/formatting boundary; reject malformed
  points rather than plot NaN/zero. Preserve trading-date semantics across zones.
- Indicator overlays, intraday intervals, drawing tools and new indicators are
  excluded. Select a chart implementation in ticket 04 after a short licence,
  React compatibility and bundle-cost check; fallback table is mandatory.

### Technical analysis

- Thin headline, narrative, `1D` timeframe and result date.
- Separate `AI explanation` and `Computed facts` treatments.
- SMA 20/50/200, RSI-14, MACD line/signal/histogram, 52-week high/low.
- Structured event labels, dates and values; distinguish fired observations from
  checks that did not fire. No frontend advice, score or invented interpretation.

### Fundamental analysis

- Headline, narrative, quarterly/annual period and result date.
- All nine metrics: trailing P/E, dividend yield, ROE, revenue QoQ/YoY, profit
  QoQ/YoY, debt/equity and operating cash flow.
- Use supplied metric unit and per-metric date. Verify percentage scaling against
  fixtures/producer before formatting. Null is unavailable, never zero; avoid
  unsupported explanations for nulls. Numeric values are code-owned facts.

### Supporting news

- Small company-scoped list, maximum five latest items; separate from AI output.
- Title, source, published date and source link using existing API fields.
- Empty and failure states are honest and never block TA/FA.

## Screen 3: Prospectus at a glance

### Overview and detail

- Header: company, board, listing date, offer price when supplied; headline,
  AI-generated label and generation date. Missing offer metadata stays unavailable.
- First view prioritises business summary, concise offer highlights and what to
  watch. Remaining detail is accessible through section anchors/expandable panels.
- Five sections: business lines; offer/share breakdown/proceeds/use of proceeds;
  financial-period comparison table/trend/highlights; ranked risk themes with
  severity text; what-to-watch points/rationale/supplied source-section labels.
- Supporting insights: Shariah with stated source, cornerstone investors,
  lock-up/moratorium and related-party transactions.
- Preserve extracted financial strings, currency and units; do not parse uncertain
  strings into computed ratios or financial charts.
- Optional lock-up/related-party fields missing in older artifacts mean `Not
  available in this analysis`. `present: false`/empty findings must be phrased as
  `Not identified in this analysis`, not definitive absence in the document.
- Expose section fallback/truncation warnings as extraction limitations. Free-text
  source-section labels are not verified page citations. Render all model text as
  text, not raw HTML; do not create links from invented source references.
- Keep costs, tokens, hashes and parser internals out of the main experience.
- Prospectus 404 means analysis unavailable; no queue/progress state can be inferred.

## Shared data, lifecycle and trust

| Condition | Behaviour |
| --- | --- |
| Loading | Panel-local skeleton; unrelated content remains usable |
| TA/FA pending | No completed result yet; do not assert processing has started |
| Running, if returned | Text status only; no fabricated percentage or timer |
| Ready | Facts, narrative, dates, source |
| Facts-only | Facts remain; explanation unavailable notice, not placeholder prose |
| Stale | Preserve result and warn it trails latest stored EOD data |
| Failed with artifact | Show retained artifact/date and failed-refresh notice |
| Failed without artifact | Local unavailable state and read retry |
| Artifact read fails | Keep thin summary/status; local detail error and retry |
| Null/empty | Explicit unavailable/empty state, never fabricated data |
| Cached result refetch fails | Retain visible data and mark refresh failure |

- A `Refresh results` action re-reads data only; no enqueue and no automatic
  progress polling. Ready state is not a live-price or accuracy guarantee.
- Cache keys/invalidation must account for changed envelope pointer/asOf so an
  old artifact is not paired with a new headline. The artifact endpoint is a
  mutable latest read: detect mismatched symbol/kind/asOf on TA/FA and mismatched
  ID/generation on prospectus, refetch once, then show a non-coherent-result
  notice rather than claim a verified pair. Backend versioned reads are follow-up
  if needed; never promise atomic reads the current API does not provide.
- TA/FA proxy strips `cost` while stored schemas require it. Add exported shared
  HTTP artifact schemas derived with `omit({ cost: true })`; do not change stored
  worker contracts/codegen or make cost optional everywhere.
- All reads use configurable API base, credentials, shared query builders and
  `apiGet`; no component fetch or direct bucket URLs.
- Display actual language metadata; default UI and showcase narration are English
  in line with current worker behaviour. No frontend translation. This replaces
  the earlier BM-only presentation expectation for this showcase milestone.
- Label private demo/non-redistributable yfinance data; preserve mixed provenance
  per panel. Avoid claiming all prospectus AI extraction is code-verified: the
  code-computed-facts distinction specifically describes stock TA/FA.
- Read retries never run analysis. Error messages must not expose stack traces,
  bucket pointers or infrastructure secrets.
- Private hosting/access control is an operator prerequisite; labels alone do not
  protect a deployment or resolve data rights.

## Accessibility and responsive behaviour

- Use current tokens/components. Semantic headings/tables, labelled controls,
  keyboard operation, visible focus, text beyond colour, reduced-motion support.
- Chart table fallback and keyboard-accessible range controls required; chart
  crosshair must not be the sole access to data.
- Desktop presenter view is primary; at 390px wide panels stack and page-level
  horizontal overflow is absent (wide tables can scroll in labelled containers).
- Do not introduce a new app-wide visual framework for this work.

## Work sequence

| Ticket | Deliverable | Dependencies |
| --- | --- | --- |
| [01](issues/01-data-readiness.md) | Deployment data/coverage audit and example selection | None |
| [02](issues/02-contracts-and-queries.md) | Browser-safe contracts, queries and refresh coherence | None |
| [03](issues/03-market-overview.md) | Snapshot, index history, movers and sectors | None (03 → 02 explicitly waived; approved revision 2) |
| [04](issues/04-stock-header-chart.md) | Stock identity and chart foundation | 02 |
| [05](issues/05-stock-analysis-panels.md) | TA/FA panels and lifecycle | 02, 04 |
| [06](issues/06-prospectus-page.md) | Prospectus reader and supporting insights | 02 |
| [07](issues/07-discovery-navigation.md) | Curated previews and focused navigation | 01, 03, 05, 06 |
| [08](issues/08-news-accessibility-polish.md) | News, responsive and accessibility integration | 03–07 |
| [09](issues/09-verification-rehearsal.md) | End-to-end checks and live rehearsal | 01–08 |

Ticket 01 gates final examples/release, not layout work using contract fixtures.
Approved revision 2 waives only the 03 → 02 dependency: ticket 03 consumes the
existing market query builders and market contracts, not ticket 02's stock/IPO
analysis additions. Ticket 02 is not certified complete; its status and all other
dependency edges remain unchanged. Ticket 03 reserves discovery layout only.
Backend gaps found there get explicit child/follow-up issues, not frontend mocks
or an unbounded worker rewrite. Existing infrastructure must not be wiped or
expensive jobs run without operator approval.

## Definition of done

- All three routes show real API-backed content with working direct reloads.
- Market snapshot/history/movers/sectors have honest source/freshness handling.
- At least one prepared stock has EOD history, usable TA and FA; at least one
  prospectus has usable summary and rich content. Target selection remains 3/2.
- No browser analysis-enqueue request, invented metric, recommendation or progress.
- Component/query tests cover lifecycle and older/missing fields; browser tests
  cover market → stock → market → prospectus and direct reloads.
- Test fixtures may support offline testing, never production demo substitution.
- Run `pnpm --filter contracts test`, `pnpm --filter frontend typecheck`,
  `pnpm --filter frontend test`, `pnpm --filter frontend build`, and
  `pnpm --filter frontend test:e2e`; record failures/skips honestly. Add relevant
  backend contract checks if backend changes become necessary.
- Manual keyboard/narrow-view checks and live rehearsal recorded; private access
  and data-rights limitations confirmed by operator before sharing.

## Out of scope

Live analysis execution/progress streaming, uploads, login/billing/watchlists,
full screener/calendar/announcement/news pages, indicator overlays/drawing tools,
investment verdicts, page-level PDF citations/viewer, worker redesign, public
launch/data licensing, official live-feed or quote-time enrichment beyond current
contracts. Market overview itself is **in scope**.
