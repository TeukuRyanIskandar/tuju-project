/**
 * Disclosure read-surface payload contracts (spec 04; ticket 02).
 *
 * The wire shapes of the five anonymous market-wide read endpoints (plus the
 * category/type filters added to the spec-02 per-company lists). Every row
 * carries one `provenance` descriptor read from its source-row lineage join
 * (`row.ingestionRunId → IngestionRun.provenanceClass`) — everything here is
 * `aggregator`-class, rendered demo-only/illustrative, and is the primary
 * decision-B purge target.
 *
 * All numerics are JS numbers: TypeORM `numeric` columns arrive as strings
 * and are converted once at this seam (null passthrough). `timestamptz`
 * columns are ISO strings; `date` columns keep their stored `YYYY-MM-DD`.
 */

import type {
  AnnouncementCategory,
  CorporateActionType,
  ProvenanceClass,
} from '../data/entities/enums';

/** One provenance descriptor per row (the demo-only label source). */
export interface ProvenanceBlock {
  provenance: ProvenanceClass;
}

/** The `stockCode` of the company's ordinary-share instrument (its natural key). */
export type CompanyCode = string;

/**
 * One disclosure row of the market-wide announcements feed / the dealings
 * view (the same rows — the dealings view is the feed filtered to
 * `SHAREHOLDING_CHANGE`, spec 04 §4). Structured buyer/seller/volume/price
 * fields are deferred to the licensed Bursa structured form.
 */
export interface MarketAnnouncementItem extends ProvenanceBlock {
  companyCode: CompanyCode;
  /** Issuing Company full name. */
  companyName: string;
  category: AnnouncementCategory;
  title: string;
  filedAt: string;
  sourceUrl: string | null;
  /** Null until the spec-06 summaries populate it. */
  aiSummary: string | null;
  aiSummaryAsOf: string | null;
}

/**
 * One announcement's own fields (`GET /announcements/:id`, spec 06 ticket
 * 03) — the `summarize-announcement` Python job's only route to an
 * announcement's content (no bulk disclosure text rides the queue, ADR-0004).
 */
export interface AnnouncementDetail extends MarketAnnouncementItem {
  id: string;
}

/**
 * One corporate-actions calendar row, keyed on `exDate` (the primary axis;
 * nullable entitlement/payment dates are not present in the demo source and
 * are omitted rather than served null — spec 04 §3). Dividends here are the
 * same rows DY reads (single source).
 */
export interface CorporateActionCalendarItem extends ProvenanceBlock {
  companyCode: CompanyCode;
  companyName: string;
  type: CorporateActionType;
  exDate: string;
  amount: number | null;
}

/** `GET /calendar/corporate-actions` — the resolved window is echoed back. */
export interface CorporateActionCalendarWindow {
  /** Resolved inclusive window bounds, ISO `YYYY-MM-DD`. */
  from: string;
  to: string;
  items: CorporateActionCalendarItem[];
}

/**
 * One results-calendar row: **when a company filed quarterly results**
 * (backward-looking — forward earnings-date estimation needs a licensed
 * source and is out of scope). `reportedAt` is the filedAt of the linked
 * `FINANCIAL_RESULTS` announcement.
 */
export interface ResultsCalendarItem extends ProvenanceBlock {
  companyCode: CompanyCode;
  companyName: string;
  fiscalYear: number;
  /** Fiscal quarter 1–4. */
  fiscalQuarter: number;
  /** The quarter's period end, ISO `YYYY-MM-DD`. */
  periodEnd: string;
  /** When the results were filed (the linked announcement's filedAt). */
  reportedAt: string;
  /** The underlying FINANCIAL_RESULTS disclosure (the link, spec 04 §3). */
  announcement: {
    title: string;
    filedAt: string;
    sourceUrl: string | null;
  };
}

/** `GET /calendar/results` — the applied date filter is echoed back. */
export interface ResultsCalendarWindow {
  /** Applied `reportedAt` bounds, ISO `YYYY-MM-DD`, null when unfiltered. */
  from: string | null;
  to: string | null;
  items: ResultsCalendarItem[];
}

/**
 * One news row (headline + link only, no body). `matchedAlias` is present on
 * the company feed (the alias that whole-word-matched the headline); the
 * market feed serves untagged market-level rows and omits it.
 */
export interface NewsItem extends ProvenanceBlock {
  headline: string;
  url: string;
  source: string;
  publishedAt: string;
  matchedAlias?: string;
}

/** Shared pagination envelope (the resolved offset/limit are echoed back). */
export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export type MarketAnnouncementsPage = Page<MarketAnnouncementItem>;
export type NewsPage = Page<NewsItem>;
