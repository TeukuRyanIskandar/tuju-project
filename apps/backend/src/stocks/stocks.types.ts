/**
 * Stock-page payload contracts (spec 02 "Stock-page payload — endpoint shape
 * B"; ticket 03).
 *
 * The wire shapes of the three anonymous read endpoints. Every data block
 * carries one `provenance` descriptor read from its source-row lineage join
 * (`row.ingestionRunId → IngestionRun.provenanceClass`), so the frontend can
 * render the "illustrative data" label wherever a block is `synthetic` (spec 02
 * "Illustrative labelling").
 *
 * All numerics are JS numbers: TypeORM `numeric`/`bigint` columns arrive as
 * strings and are converted once at this seam (`Number(x)`, null passthrough).
 */

import type {
  AnnouncementCategory,
  CorporateActionType,
  ListingBoard,
  ProvenanceClass,
  ShariahComplianceStatus,
} from '../data/entities/enums';

/** One provenance descriptor per data block (the illustrative-label source). */
export interface ProvenanceBlock {
  provenance: ProvenanceClass;
}

/** Identity block (`real`): Instrument ⋈ Company ⋈ Sector. */
export interface IdentityBlock extends ProvenanceBlock {
  stockCode: string;
  shortName: string;
  /** Instrument full name. */
  fullName: string;
  /** Issuing Company full name (distinct from the instrument's). */
  companyName: string;
  board: ListingBoard;
  /** `Sector.name` (Bursa's own classification, real reference data). */
  sector: string;
}

/**
 * Fundamentals block (`synthetic`): ratios READ from the materialised
 * `FundamentalsSnapshot` columns — never recomputed here (they are defined once
 * at ingest so screener and stock page agree). `lossMaking` is the only
 * read-time derivation (`ttmEps <= 0`; the stored P/E is already null there).
 */
export interface FundamentalsBlock extends ProvenanceBlock {
  peRatio: number | null;
  dividendYield: number | null;
  pntaRatio: number | null;
  roe: number | null;
  debtToEquity: number | null;
  psr: number | null;
  ttmEps: number;
  ttmRevenue: number;
  ttmNetProfit: number;
  ntaPerShare: number;
  sharesOutstanding: number;
  consecutiveGrowthQuarters: number;
  lossMaking: boolean;
}

/**
 * Technicals block (`synthetic`): the latest `IndicatorSnapshot` plus
 * `pctChange`, the one read-time computation (from the two latest EOD
 * `PriceBar`s — the EOD snapshot, never the intraday replay). `null` when the
 * company has no indicator snapshot yet.
 */
export interface TechnicalsBlock extends ProvenanceBlock {
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  week52High: number | null;
  week52Low: number | null;
  latestClose: number;
  pctChange: number | null;
}

/**
 * Shariah block (`real`). Always present — unlike fundamentals/technicals, a
 * company with no `ShariahStatus` row serves `status`/`effectiveDate` as null
 * with the provenance descriptor still `real` (the data class is real public
 * reference data; only the row is absent).
 */
export interface ShariahBlock extends ProvenanceBlock {
  status: ShariahComplianceStatus | null;
  /** `date` column — served as its stored ISO `YYYY-MM-DD` string. */
  effectiveDate: string | null;
}

/** `GET /stocks/:code` — the bounded core snapshot (one round trip). */
export interface StockCorePayload {
  identity: IdentityBlock;
  /** Null when the company has no snapshot rows yet (identity still served). */
  fundamentals: FundamentalsBlock | null;
  technicals: TechnicalsBlock | null;
  shariah: ShariahBlock;
}

/** One announcement row, with its own lineage provenance (`aggregator`). */
export interface AnnouncementItem extends ProvenanceBlock {
  category: AnnouncementCategory;
  title: string;
  /** `timestamptz` column — served as an ISO string. */
  filedAt: string;
  sourceUrl: string | null;
  /** Null until the spec-06 summaries populate it. */
  aiSummary: string | null;
  /** When the AI summary was generated; null until then (spec 04 field). */
  aiSummaryAsOf: string | null;
}

/** One corporate-action row, with its own lineage provenance (`aggregator`). */
export interface CorporateActionItem extends ProvenanceBlock {
  type: CorporateActionType;
  /** `date` column — served as its stored ISO `YYYY-MM-DD` string. */
  exDate: string;
  amount: number | null;
}

/** Shared pagination envelope (the resolved offset/limit are echoed back). */
export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export type AnnouncementsPage = Page<AnnouncementItem>;
export type CorporateActionsPage = Page<CorporateActionItem>;
