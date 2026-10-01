# free-tier-disclosures — execution effort (spec 04 implementation)

Breaking [spec 04 — announcements + news + corporate
events](../free-tier-specs/04-announcements-news-corporate-events.md) into build
tickets. Backend only. Ticket work lands in `apps/backend`.

## Ticket status

| # | Ticket | Wave | Blocked by | Status |
| - | ------ | ---- | ---------- | ------ |
| 01 | [Disclosure model additions + label mapping + news tagging + richer demo snapshot](issues/01-model-tagging-and-snapshot.md) | 1 | — | **resolved** |
| 02 | [Market feed, dealings view, calendars, news feed + per-company filters](issues/02-market-reads-and-calendars.md) | 2 | 01 | **resolved** |

## Wave structure

- **Wave 1 (done):** ticket 01 — the model/ingestion half. Additive columns
  (`Announcement.aiSummaryAsOf`, `NewsArticleTag.matchedAlias`), the aggregator
  label→enum categorisation, the deterministic news alias tagger, richer demo
  snapshot rows (so feeds/calendars have content), and the
  `cache:disclosures:` prefix sweep hooks on nightly ingest + purge.
- **Wave 2 (done):** ticket 02 — the read half. The `src/disclosures/` module
  (market announcements feed, dealings view, two derived calendars, tagged news
  feed), the category/type filters on the existing per-company stock-page
  lists, and `app.module.ts` wiring.

## Decisions / notes so far

- **Per-company endpoints are the existing spec-02 routes, extended.** Spec 04
  lists `GET /companies/:code/announcements?category&…` /
  `GET /companies/:code/corporate-actions?type&…` as "spec-02's per-company
  feed". Spec 02 shipped those reads as `/stocks/:code/announcements` and
  `/stocks/:code/corporate-actions` over the same model; this effort adds the
  `category` (one-or-more) and `type` filters there instead of duplicating the
  routes under `/companies/`. One route per concept; FE unaffected.
- **`matchedAlias` is NOT NULL.** Nothing has ever written `news_article_tags`
  before this effort (the tagger is new), so the column can be required — the
  tagger always knows the alias that matched.
- **CorporateAction gains no new columns.** Spec 04 §3 mentions
  `entitlementDate`/`paymentDate` "where present" and `announcedAt`, but the
  authoritative "Model additions" list adds none of them, and the demo
  aggregator reliably presents only `exDate` + `amount`. Structured/calendar
  depth waits for the licensed feed (same fog as structured dealings fields);
  the calendar serves `exDate` as its axis and omits absent fields.
- **Results-calendar linkage is a read-time join, not an FK.**
  `reportedAt` = `filedAt` of the company's `FINANCIAL_RESULTS` announcement;
  the link is "earliest results announcement filed on/after the quarter's
  `periodEnd`" (the demo adapter files exactly one per quarter, so the join is
  exact there; a licensed structured feed can tighten it later). Quarters with
  no filed announcement are not on a when-filed calendar.
- **Provenance of a results-calendar row** is the linked *announcement's* run
  class (`aggregator`) — the row's axis is when results were **filed**, a
  disclosure fact; the fiscal-quarter figures come from the synthetic
  quarterly rows. Both classes are decision-B purge targets.
- **Demo snapshot dates are now-relative** for feed/calendar rows (dealings
  filed now−2d/−9d, an entitlement now−5d, a dividend with exDate now+10d,
  etc.) so the default calendar window (7 back + 30 ahead) always has content.
  The DY-feeding dividend row keeps its fixed `2025-09-15` exDate (inside the
  generator's trailing window; a now+10d dividend is *ahead* of the last
  synthetic bar's date and so never enters DY).
- **Tagging is delete-then-reinsert per article.** Tags are derived rows: a
  re-ingest recomputes them from the (stable-url, possibly updated) headline,
  so replacing the article's tag set is the idempotent move — a stale tag from
  an older headline must not survive a headline change.
- **News tagging needs `shortName`, which lives on `Instrument`** (Company has
  `fullName` + curated `aliases` only). The worker loads Company ⋈ Instrument
  once per ingest to build the alias sets (`shortName` first, so
  `matchedAlias` prefers it per "match primarily on shortName/alias").

## Verification (both tickets)

typecheck clean; **unit lane 100% green**; `build` clean; **integration lane
(testcontainers, `test:int`) green** — 4/4 suites including the new
`disclosures.int.spec.ts`. Docker required for the int lane.
