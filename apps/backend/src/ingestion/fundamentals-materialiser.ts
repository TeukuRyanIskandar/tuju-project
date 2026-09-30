/**
 * Fundamentals ratio materialisation (spec 01 "Ratio definitions"; ticket 04).
 *
 * After each quarterly ingest the worker recomputes the derived per-company
 * rollup — TTM figures + P/E, DY, P/NTA, ROE, D/E, PSR and consecutive-growth —
 * and writes one latest {@link FundamentalsSnapshot} per company. Consumers read
 * these; they never compute at query time (spec 01).
 *
 * The ratios are defined **once** in the synthetic `ratios` module (the same
 * definitions the co-generation reconciliation test pins) and reused here over the
 * persisted rows, so screener and stock page agree and the A1 reconciliation holds
 * end-to-end. This module maps the seam's plain-`number` DTOs onto the exact-scale
 * decimal-string inputs those pure ratio functions expect.
 */

import type { FundamentalsDto, PriceBarDto } from '../data/adapters/dto';
import { CorporateActionType } from '../data/entities/enums';
import { SCALE } from '../data/synthetic';
import * as ratios from '../data/synthetic/ratios';
import type {
  CorporateActionDto as GenCorporateActionDto,
  PriceBarDto as GenPriceBarDto,
  QuarterlyFinancialsDto as GenQuarterlyDto,
} from '../data/synthetic/types';
import { toStringAtScale } from '../data/synthetic/decimal';

/** The materialised snapshot columns (all DB strings / int), keyed for persist. */
export interface MaterialisedSnapshot {
  sharesOutstanding: string;
  ntaPerShare: string;
  ttmEps: string;
  ttmRevenue: string;
  ttmNetProfit: string;
  peRatio: string | null;
  dividendYield: string | null;
  pntaRatio: string | null;
  roe: string | null;
  debtToEquity: string | null;
  psr: string | null;
  consecutiveGrowthQuarters: number;
}

/** Map a seam price-bar DTO (numbers) → the generator's exact-scale string DTO. */
function toGenBar(bar: PriceBarDto): GenPriceBarDto {
  return {
    tradeDate: bar.tradeDate,
    open: bar.open.toFixed(SCALE.price),
    high: bar.high.toFixed(SCALE.price),
    low: bar.low.toFixed(SCALE.price),
    close: bar.close.toFixed(SCALE.price),
    volume: Math.trunc(bar.volume).toString(),
  };
}

/** Map a seam quarterly DTO (numbers) → the generator's exact-scale string DTO. */
function toGenQuarter(
  q: FundamentalsDto['quarters'][number],
): GenQuarterlyDto {
  return {
    fiscalYear: q.fiscalYear,
    fiscalQuarter: q.fiscalQuarter,
    periodEnd: q.periodEnd,
    revenue: q.revenue.toFixed(SCALE.money),
    netProfit: q.netProfit.toFixed(SCALE.money),
    eps: q.eps.toFixed(SCALE.eps),
    equity: q.equity.toFixed(SCALE.money),
    nta: q.nta.toFixed(SCALE.money),
    intangibles: q.intangibles.toFixed(SCALE.money),
    totalBorrowings: q.totalBorrowings.toFixed(SCALE.money),
  };
}

/**
 * Materialise the FundamentalsSnapshot ratios for one company from its persisted
 * bars, quarterly financials and dividend corporate actions.
 *
 * @param fundamentals the company's fundamentals batch (shares + quarters).
 * @param bars         the company's price bars (any order; latest close is used).
 * @param dividends    trailing dividend actions for the company (feed DY). Each is
 *                     `{ exDate, amount }` in RM/share.
 */
export function materialiseSnapshot(
  fundamentals: FundamentalsDto,
  bars: readonly PriceBarDto[],
  dividends: readonly { exDate: string; amount: number | null }[],
): MaterialisedSnapshot {
  if (bars.length === 0) {
    throw new Error(
      `materialiseSnapshot: no price bars for ${fundamentals.stockCode}`,
    );
  }
  // Bars ordered ascending by trade date so `last` is the latest close.
  const genBars: GenPriceBarDto[] = [...bars]
    .sort((a, b) => (a.tradeDate < b.tradeDate ? -1 : a.tradeDate > b.tradeDate ? 1 : 0))
    .map(toGenBar);

  // Quarters ordered ascending by period end so TTM windows and YoY are correct.
  const genQuarters: GenQuarterlyDto[] = [...fundamentals.quarters]
    .sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : a.periodEnd > b.periodEnd ? 1 : 0))
    .map(toGenQuarter);

  const genDividends: GenCorporateActionDto[] = dividends
    .filter((d) => d.amount !== null)
    .map((d) => ({
      type: CorporateActionType.Dividend,
      exDate: d.exDate,
      amount: (d.amount as number).toFixed(SCALE.dividend),
    }));

  const shares = Math.trunc(fundamentals.sharesOutstanding).toString();

  const pe = ratios.peRatio(genBars, genQuarters);
  const eps = ratios.ttmEps(genQuarters);

  return {
    sharesOutstanding: shares,
    ntaPerShare: ratios.ratioString(ratios.ntaPerShare(genQuarters, shares)),
    ttmEps: toStringAtScale(eps, SCALE.eps),
    ttmRevenue: ratios.moneyString(ratios.ttmRevenue(genQuarters)),
    ttmNetProfit: ratios.moneyString(ratios.ttmNetProfit(genQuarters)),
    peRatio: pe === null ? null : ratios.ratioString(pe),
    dividendYield: ratios.ratioString(ratios.dividendYield(genBars, genDividends)),
    pntaRatio: ratios.ratioString(ratios.pntaRatio(genBars, genQuarters, shares)),
    roe: ratios.ratioString(ratios.roe(genQuarters)),
    debtToEquity: ratios.ratioString(ratios.debtToEquity(genQuarters)),
    psr: ratios.ratioString(ratios.psr(genBars, genQuarters, shares)),
    consecutiveGrowthQuarters: ratios.consecutiveGrowthQuarters(genQuarters),
  };
}
