/**
 * Plain in-memory DTO shapes for the synthetic co-generation generator (spec 01,
 * ticket 03). These mirror the persisted-entity *fields* the reconciled timeline
 * carries, but hold **no** TypeORM decorators, ids, FKs, or `createdAt` — the
 * generator is pure computation; persistence (ids, FK wiring, run rows) is
 * ticket 04's job.
 *
 * All money / price / ratio figures are exact numeric strings at the same scale
 * as their target `numeric` column, so a downstream persister writes them
 * verbatim and every derived ratio reconciles (decision A1).
 */

import { CorporateActionType } from '../entities/enums';

/** Scales pinned to the entity `numeric` column definitions (do not change). */
export const SCALE = {
  /** PriceBar open/high/low/close — numeric(18,6). */
  price: 6,
  /** QuarterlyFinancials revenue/netProfit/equity/nta/intangibles/borrowings — numeric(20,2). */
  money: 2,
  /** EPS — numeric(18,6). */
  eps: 6,
  /** FundamentalsSnapshot ratios / ntaPerShare — numeric(18,6). */
  ratio: 6,
  /** CorporateAction.amount (dividend per share) — numeric(18,6). */
  dividend: 6,
} as const;

/** Mirrors {@link PriceBar} emitted fields (no id / FK / createdAt). */
export interface PriceBarDto {
  /** ISO `YYYY-MM-DD` trading day. */
  tradeDate: string;
  /** numeric(18,6) string. */
  open: string;
  high: string;
  low: string;
  close: string;
  /** bigint string. */
  volume: string;
}

/** Mirrors {@link QuarterlyFinancials} emitted fields (no id / FK / createdAt). */
export interface QuarterlyFinancialsDto {
  fiscalYear: number;
  /** 1–4. */
  fiscalQuarter: number;
  /** ISO `YYYY-MM-DD` period-end. */
  periodEnd: string;
  /** numeric(20,2) strings. */
  revenue: string;
  netProfit: string;
  /** numeric(18,6) — may be negative for a loss-maker. */
  eps: string;
  equity: string;
  nta: string;
  intangibles: string;
  totalBorrowings: string;
}

/** Mirrors the dividend {@link CorporateAction}s this run owns (feeds DY). */
export interface CorporateActionDto {
  type: CorporateActionType;
  /** ISO `YYYY-MM-DD` ex-date. */
  exDate: string;
  /** Per-share amount, numeric(18,6) string, or null. */
  amount: string | null;
}

/** Mirrors {@link FundamentalsSnapshot} derived fields (no id / FK / createdAt). */
export interface FundamentalsSnapshotDto {
  /** bigint string, constant across the timeline (A1). */
  sharesOutstanding: string;
  /** numeric(18,6) strings. */
  ntaPerShare: string;
  ttmEps: string;
  /** numeric(20,2) strings. */
  ttmRevenue: string;
  ttmNetProfit: string;
  /** numeric(18,6) or null (P/E null when TTM EPS ≤ 0). */
  peRatio: string | null;
  dividendYield: string | null;
  pntaRatio: string | null;
  roe: string | null;
  debtToEquity: string | null;
  psr: string | null;
  consecutiveGrowthQuarters: number;
}

/** Tunable generation params (stored on {@link SyntheticRun.params}). */
export interface SyntheticParams {
  /** Trading days of daily bars to emit (3y ≈ 750, warms SMA-200). */
  tradingDays: number;
  /** Quarters of financials to emit (3y = 12; satisfies YoY + consecutive growth). */
  quarters: number;
  /** Shares outstanding, held constant across the timeline (A1). */
  sharesOutstanding: number;
  /** Starting close price (RM). */
  startPrice: number;
  /** Daily log-return drift. */
  dailyDrift: number;
  /** Daily log-return volatility. */
  dailyVolatility: number;
  /** Base quarterly revenue (RM). */
  baseQuarterlyRevenue: number;
  /** Quarterly revenue growth rate (compounded per quarter). */
  revenueGrowth: number;
  /** Net margin applied to revenue to get net profit. */
  netMargin: number;
  /** Opening equity (RM). */
  openingEquity: number;
  /** Intangibles as a fraction of equity (keeps P/NTA ≠ P/B). */
  intangiblesRatio: number;
  /** Total interest-bearing borrowings as a fraction of equity. */
  debtRatio: number;
  /** Annual dividend per share (paid across the year as ex-date actions). */
  annualDividendPerShare: number;
  /** Number of dividend actions per year. */
  dividendsPerYear: number;
  /** Anchor date the timeline ends on (most recent bar / latest period). ISO date. */
  endDate: string;
  /**
   * Force the latest fiscal year to be loss-making (negative net profit), so the
   * P/E-null edge case is exercised deterministically. Default false.
   */
  forceLatestLoss?: boolean;
}

/** The complete reconciled in-memory dataset a synthetic run produces. */
export interface SyntheticDataset {
  seed: number;
  params: SyntheticParams;
  priceBars: PriceBarDto[];
  quarterlyFinancials: QuarterlyFinancialsDto[];
  dividends: CorporateActionDto[];
  snapshot: FundamentalsSnapshotDto;
}

/** Default params for a credible mid-cap ordinary share (3-year backfill). */
export const DEFAULT_PARAMS: SyntheticParams = {
  tradingDays: 750,
  quarters: 12,
  sharesOutstanding: 500_000_000,
  startPrice: 2.5,
  dailyDrift: 0.0002,
  dailyVolatility: 0.015,
  baseQuarterlyRevenue: 180_000_000,
  revenueGrowth: 0.03,
  netMargin: 0.12,
  openingEquity: 900_000_000,
  intangiblesRatio: 0.08,
  debtRatio: 0.35,
  annualDividendPerShare: 0.1,
  dividendsPerYear: 2,
  endDate: '2025-12-31',
};
