import { z } from 'zod';
import {
  AnnouncementCategory,
  CorporateActionType,
  IsoDate,
  IsoDateTime,
  ListingBoard,
  Page,
  ProvenanceClass,
  ShariahStatus,
  provenanceShape,
} from './common.js';

/**
 * `GET /stocks/:code`, `/stocks/:code/announcements`,
 * `/stocks/:code/corporate-actions` (spec 02). All numerics are JS numbers.
 */

/** Identity block (`real`): Instrument + Company + Sector. */
export const IdentityBlock = z.strictObject({
  ...provenanceShape,
  stockCode: z.string(),
  shortName: z.string(),
  fullName: z.string(),
  /** Issuing Company full name (distinct from the instrument's). */
  companyName: z.string(),
  board: ListingBoard,
  sector: z.string(),
});
export type IdentityBlock = z.infer<typeof IdentityBlock>;

/** Fundamentals block (`synthetic`): materialised ratios, read not recomputed. */
export const FundamentalsBlock = z.strictObject({
  ...provenanceShape,
  peRatio: z.number().nullable(),
  dividendYield: z.number().nullable(),
  pntaRatio: z.number().nullable(),
  roe: z.number().nullable(),
  debtToEquity: z.number().nullable(),
  psr: z.number().nullable(),
  ttmEps: z.number(),
  ttmRevenue: z.number(),
  ttmNetProfit: z.number(),
  ntaPerShare: z.number(),
  sharesOutstanding: z.number(),
  consecutiveGrowthQuarters: z.number().int(),
  lossMaking: z.boolean(),
});
export type FundamentalsBlock = z.infer<typeof FundamentalsBlock>;

/** Technicals block (`synthetic`): latest indicator snapshot + read-time `pctChange`. */
export const TechnicalsBlock = z.strictObject({
  ...provenanceShape,
  sma20: z.number().nullable(),
  sma50: z.number().nullable(),
  sma200: z.number().nullable(),
  rsi14: z.number().nullable(),
  macd: z.number().nullable(),
  macdSignal: z.number().nullable(),
  week52High: z.number().nullable(),
  week52Low: z.number().nullable(),
  latestClose: z.number(),
  pctChange: z.number().nullable(),
});
export type TechnicalsBlock = z.infer<typeof TechnicalsBlock>;

/** Shariah block (`real`). Always present; `status`/`effectiveDate` null with no row. */
export const ShariahBlock = z.strictObject({
  ...provenanceShape,
  status: ShariahStatus.nullable(),
  effectiveDate: IsoDate.nullable(),
});
export type ShariahBlock = z.infer<typeof ShariahBlock>;

/** `GET /stocks/:code` — the bounded core snapshot. */
export const StockCorePayload = z.strictObject({
  identity: IdentityBlock,
  fundamentals: FundamentalsBlock.nullable(),
  technicals: TechnicalsBlock.nullable(),
  shariah: ShariahBlock,
});
export type StockCorePayload = z.infer<typeof StockCorePayload>;

/** One per-company announcement row (`aggregator`). */
export const AnnouncementItem = z.strictObject({
  ...provenanceShape,
  category: AnnouncementCategory,
  title: z.string(),
  filedAt: IsoDateTime,
  sourceUrl: z.string().nullable(),
  aiSummary: z.string().nullable(),
  aiSummaryAsOf: IsoDateTime.nullable(),
});
export type AnnouncementItem = z.infer<typeof AnnouncementItem>;

/** One per-company corporate-action row (`aggregator`). */
export const CorporateActionItem = z.strictObject({
  ...provenanceShape,
  type: CorporateActionType,
  exDate: IsoDate,
  amount: z.number().nullable(),
});
export type CorporateActionItem = z.infer<typeof CorporateActionItem>;

export const AnnouncementsPage = Page(AnnouncementItem);
export type AnnouncementsPage = z.infer<typeof AnnouncementsPage>;

export const CorporateActionsPage = Page(CorporateActionItem);
export type CorporateActionsPage = z.infer<typeof CorporateActionsPage>;

/** One EOD OHLC+volume bar (`GET /stocks/:code/series`). Quantities are string NUMERIC. */
export const StockSeriesPoint = z.strictObject({
  date: IsoDate,
  open: z.string(),
  high: z.string(),
  low: z.string(),
  close: z.string(),
  volume: z.string(),
});
export type StockSeriesPoint = z.infer<typeof StockSeriesPoint>;

/** `GET /stocks/:code/series?interval=1d&range=2y` — PoC-fixed window. */
export const StockSeriesResponse = z.strictObject({
  code: z.string(),
  interval: z.literal('1d'),
  range: z.literal('2y'),
  points: z.array(StockSeriesPoint),
  provenance: ProvenanceClass,
  demoLabel: z.literal('private-demo'),
});
export type StockSeriesResponse = z.infer<typeof StockSeriesResponse>;

/** Latest TA/FA analysis read status (PoC Phase A). */
export const StockAnalysisStatus = z.enum([
  'pending',
  'running',
  'ready',
  'facts_only',
  'failed',
  'stale',
]);
export type StockAnalysisStatus = z.infer<typeof StockAnalysisStatus>;

const analysisArtifactPointer = z
  .strictObject({ bucket: z.string(), key: z.string() })
  .nullable();

const stockAnalysisThinFields = {
  code: z.string(),
  status: StockAnalysisStatus,
  headline: z.string().nullable(),
  asOf: IsoDateTime.nullable(),
  artifact: analysisArtifactPointer,
  artifactPath: z.string().nullable(),
  errorMessage: z.string().nullable(),
} as const;

/** `GET /stocks/:code/analysis/technical` — thin envelope; rich body via artifactPath. */
export const StockTechnicalAnalysisResponse = z.strictObject({
  ...stockAnalysisThinFields,
  jobName: z.literal('analyze-technical'),
});
export type StockTechnicalAnalysisResponse = z.infer<
  typeof StockTechnicalAnalysisResponse
>;

/** `GET /stocks/:code/analysis/fundamental` — thin envelope; rich body via artifactPath. */
export const StockFundamentalAnalysisResponse = z.strictObject({
  ...stockAnalysisThinFields,
  jobName: z.literal('analyze-fundamental'),
});
export type StockFundamentalAnalysisResponse = z.infer<
  typeof StockFundamentalAnalysisResponse
>;
