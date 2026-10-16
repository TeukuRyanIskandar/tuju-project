import type { FundamentalsSnapshot } from '../data/entities/fundamentals-snapshot.entity';
import type { IndicatorSnapshot } from '../data/entities/indicator-snapshot.entity';
import type { Instrument } from '../data/entities/instrument.entity';
import type { QuarterlyFinancials } from '../data/entities/quarterly-financials.entity';
import type { TechnicalEvent } from './technical-events';
import { toNumber } from './serialisation';
import type { FundamentalMetricId, FundamentalMetricScale } from '@tuju/contracts';

export interface TechnicalFacts {
  sma: {
    p20: number | null;
    p50: number | null;
    p200: number | null;
  };
  rsi: {
    period: 14;
    value: number | null;
  };
  macd: {
    line: number | null;
    signal: number | null;
    histogram: number | null;
  };
  week52: {
    high: number | null;
    low: number | null;
  };
  latestClose: number | null;
}

export interface FundamentalMetric {
  id: FundamentalMetricId;
  label: string;
  value: number | null;
  unit: string;
  scale: FundamentalMetricScale;
  asOf: string;
}

export interface FundamentalFacts {
  metrics: FundamentalMetric[];
}

export interface AnalysisReferenceResponse {
  code: string;
  shortName: string;
  latestCloseDay: string;
  asOfDatetime: string;
  technical: TechnicalFacts;
  technicalEvents: TechnicalEvent[];
  fundamental: FundamentalFacts;
}

/**
 * Assemble a complete analysis reference response from pre-loaded entities.
 * Worker-facing shape (not in @tuju/contracts).
 *
 * @param instrument Instrument entity with relations
 * @param snap IndicatorSnapshot (null if no data)
 * @param fundSnap FundamentalsSnapshot (may be null)
 * @param quarters Array of latest 2 QuarterlyFinancials rows (newest first), may be empty
 * @param technicalEvents Pre-computed 7 TA events
 * @param latestCloseDay Calendar date (YYYY-MM-DD) of latest EOD close
 * @param asOfDatetime ISO 8601 datetime with offset
 * @returns Complete reference payload
 */
export function toAnalysisReference(
  instrument: Instrument,
  snap: IndicatorSnapshot,
  fundSnap: FundamentalsSnapshot | null,
  quarters: QuarterlyFinancials[],
  technicalEvents: TechnicalEvent[],
  latestCloseDay: string,
  asOfDatetime: string,
): AnalysisReferenceResponse {
  // Build TA facts block
  const technicalFacts: TechnicalFacts = {
    sma: {
      p20: snap.sma20 ? toNumber(snap.sma20) : null,
      p50: snap.sma50 ? toNumber(snap.sma50) : null,
      p200: snap.sma200 ? toNumber(snap.sma200) : null,
    },
    rsi: {
      period: 14,
      value: snap.rsi14 ? toNumber(snap.rsi14) : null,
    },
    macd: {
      line: snap.macd ? toNumber(snap.macd) : null,
      signal: snap.macdSignal ? toNumber(snap.macdSignal) : null,
      histogram: (() => {
        const line = snap.macd ? toNumber(snap.macd) : null;
        const signal = snap.macdSignal ? toNumber(snap.macdSignal) : null;
        return line !== null && signal !== null ? line - signal : null;
      })(),
    },
    week52: {
      high: snap.week52High ? toNumber(snap.week52High) : null,
      low: snap.week52Low ? toNumber(snap.week52Low) : null,
    },
    latestClose: snap.latestClose ? toNumber(snap.latestClose) : null,
  };

  // Build FA metrics block (exactly 9)
  const metrics: FundamentalMetric[] = [];

  // Snapshot-based metrics (asOf = latestCloseDay)
  metrics.push({
    id: 'trailing_pe',
    label: 'P/E ratio (trailing)',
    value: fundSnap ? toNumber(fundSnap.peRatio) : null,
    unit: 'x',
    scale: 'absolute',
    asOf: latestCloseDay,
  });

  metrics.push({
    id: 'dividend_yield',
    label: 'Dividend yield',
    value: fundSnap ? toNumber(fundSnap.dividendYield) : null,
    unit: '%',
    scale: 'fraction',
    asOf: latestCloseDay,
  });

  metrics.push({
    id: 'roe',
    label: 'Return on equity',
    value: fundSnap ? toNumber(fundSnap.roe) : null,
    unit: '%',
    scale: 'fraction',
    asOf: latestCloseDay,
  });

  metrics.push({
    id: 'debt_to_equity',
    label: 'Debt to equity',
    value: fundSnap ? toNumber(fundSnap.debtToEquity) : null,
    unit: 'x',
    scale: 'absolute',
    asOf: latestCloseDay,
  });

  // Quarterly-based growth metrics (asOf = quarters[0].periodEnd or null)
  const q0PeriodEnd = quarters.length > 0 ? quarters[0].periodEnd : latestCloseDay;

  // Revenue growth QoQ: (q0.revenue - q1.revenue) / |q1.revenue| * 100
  let revGrowthQoQ: number | null = null;
  if (quarters.length >= 2) {
    const q0Rev = toNumber(quarters[0].revenue);
    const q1Rev = toNumber(quarters[1].revenue);
    if (q0Rev !== null && q1Rev !== null && q1Rev !== 0) {
      revGrowthQoQ = ((q0Rev - q1Rev) / Math.abs(q1Rev)) * 100;
    }
  }
  metrics.push({
    id: 'revenue_growth_qoq',
    label: 'Revenue growth (QoQ)',
    value: revGrowthQoQ,
    unit: '%',
    scale: 'percentage_point',
    asOf: q0PeriodEnd,
  });

  // Revenue growth YoY: (q0.revenue - q[-4].revenue) / |q[-4].revenue| * 100
  // Note: quarters array is at most 2 rows (latest 2), so YoY comparison not possible with just 2 rows
  // For PoC, we set to null (quarterly data depth is follow-on)
  metrics.push({
    id: 'revenue_growth_yoy',
    label: 'Revenue growth (YoY)',
    value: null,
    unit: '%',
    scale: 'percentage_point',
    asOf: q0PeriodEnd,
  });

  // Profit growth QoQ: (q0.netProfit - q1.netProfit) / |q1.netProfit| * 100
  let profitGrowthQoQ: number | null = null;
  if (quarters.length >= 2) {
    const q0Profit = toNumber(quarters[0].netProfit);
    const q1Profit = toNumber(quarters[1].netProfit);
    if (q0Profit !== null && q1Profit !== null && q1Profit !== 0) {
      profitGrowthQoQ = ((q0Profit - q1Profit) / Math.abs(q1Profit)) * 100;
    }
  }
  metrics.push({
    id: 'profit_growth_qoq',
    label: 'Profit growth (QoQ)',
    value: profitGrowthQoQ,
    unit: '%',
    scale: 'percentage_point',
    asOf: q0PeriodEnd,
  });

  // Profit growth YoY: not available with 2-quarter lookback
  metrics.push({
    id: 'profit_growth_yoy',
    label: 'Profit growth (YoY)',
    value: null,
    unit: '%',
    scale: 'percentage_point',
    asOf: q0PeriodEnd,
  });

  // Operating cash flow: always null for PoC (OCF ingest is follow-on)
  metrics.push({
    id: 'operating_cash_flow',
    label: 'Operating cash flow',
    value: null,
    unit: 'RM bn',
    scale: 'absolute',
    asOf: latestCloseDay,
  });

  return {
    code: instrument.stockCode,
    shortName: instrument.shortName,
    latestCloseDay,
    asOfDatetime,
    technical: technicalFacts,
    technicalEvents,
    fundamental: { metrics },
  };
}
