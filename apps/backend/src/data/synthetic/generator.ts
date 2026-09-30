/**
 * The synthetic co-generation generator (spec 01, decision A1, ticket 03).
 *
 * A **pure, deterministic, seeded** function: `generate(seed, params)` co-produces
 * the reconciled 3-year timeline — daily {@link PriceBarDto}s (~750, warms
 * SMA-200), quarterly {@link QuarterlyFinancialsDto} (12 quarters), the dividend
 * {@link CorporateActionDto} stream (feeds DY), and the derived
 * {@link FundamentalsSnapshotDto} whose ratios are materialised from those very
 * rows. No TypeORM, no DB, no `Math.random`, no wall clock — same seed + params
 * ⇒ byte-identical output.
 *
 * Reconciliation is guaranteed by construction: the snapshot ratios are computed
 * through {@link ./ratios}, which derives every figure only from the emitted
 * DTOs — the same path the reconciliation test recomputes.
 */

import { CorporateActionType } from '../entities/enums';
import { Prng, deriveSeed } from './prng';
import {
  Decimal,
  divide,
  fromNumber,
  fromUnits,
  toStringAtScale,
} from './decimal';
import {
  CorporateActionDto,
  DEFAULT_PARAMS,
  FundamentalsSnapshotDto,
  PriceBarDto,
  QuarterlyFinancialsDto,
  SCALE,
  SyntheticDataset,
  SyntheticParams,
} from './types';
import {
  consecutiveGrowthQuarters,
  debtToEquity,
  dividendYield,
  moneyString,
  ntaPerShare,
  peRatio,
  pntaRatio,
  psr,
  ratioString,
  roe,
  ttmEps,
  ttmNetProfit,
  ttmRevenue,
} from './ratios';

/**
 * Co-generate the reconciled dataset for one company from a seed.
 *
 * @param seed   32-bit seed; the sole source of randomness.
 * @param params generation params; defaults to a credible mid-cap ordinary share.
 */
export function generate(
  seed: number,
  params: SyntheticParams = DEFAULT_PARAMS,
): SyntheticDataset {
  const quarterlyFinancials = generateQuarterly(seed, params);
  const priceBars = generatePriceBars(seed, params);
  const dividends = generateDividends(seed, params);
  const snapshot = buildSnapshot(
    priceBars,
    quarterlyFinancials,
    dividends,
    params,
  );

  return {
    seed,
    params,
    priceBars,
    quarterlyFinancials,
    dividends,
    snapshot,
  };
}

// ---------- price bars ----------

/**
 * Emit ~`tradingDays` daily bars via a seeded geometric-random-walk on the close,
 * ending on `endDate` (weekdays only, so ~5 bars/week like real trading days).
 * OHLC is derived per day: open near prior close, high/low bracket the range.
 */
function generatePriceBars(
  seed: number,
  params: SyntheticParams,
): PriceBarDto[] {
  const rng = new Prng(deriveSeed(seed, 'prices'));
  const volRng = new Prng(deriveSeed(seed, 'volume'));

  const dates = tradingDaysEndingAt(params.endDate, params.tradingDays);
  const bars: PriceBarDto[] = [];

  let close = params.startPrice;
  let prevClose = params.startPrice;
  for (let i = 0; i < dates.length; i++) {
    // Log-return random walk.
    const shock = rng.nextGaussian();
    const logReturn = params.dailyDrift + params.dailyVolatility * shock;
    const factor = Math.exp(logReturn);

    const open = i === 0 ? params.startPrice : prevClose;
    close = i === 0 ? params.startPrice : prevClose * factor;

    // Intraday range around open/close.
    const intradaySwing = params.dailyVolatility * (0.5 + rng.next());
    const hi = Math.max(open, close) * (1 + Math.abs(intradaySwing) * rng.next());
    const lo = Math.min(open, close) * (1 - Math.abs(intradaySwing) * rng.next());

    const volume = Math.floor(volRng.nextInRange(200_000, 5_000_000));

    bars.push({
      tradeDate: dates[i],
      open: toStringAtScale(fromNumber(open, SCALE.price), SCALE.price),
      high: toStringAtScale(fromNumber(hi, SCALE.price), SCALE.price),
      low: toStringAtScale(fromNumber(lo, SCALE.price), SCALE.price),
      close: toStringAtScale(fromNumber(close, SCALE.price), SCALE.price),
      volume: volume.toString(),
    });

    prevClose = close;
  }

  return bars;
}

// ---------- quarterly financials ----------

/**
 * Emit `quarters` fiscal quarters ending on the quarter of `endDate`. Revenue
 * compounds at `revenueGrowth`; net profit = revenue × `netMargin` with small
 * seeded jitter (so YoY is not perfectly monotone but stays reconcilable). EPS
 * is derived from net profit ÷ shares. Equity walks up by retained profit;
 * intangibles = intangiblesRatio × equity (keeps P/NTA ≠ P/B); borrowings =
 * debtRatio × equity.
 */
function generateQuarterly(
  seed: number,
  params: SyntheticParams,
): QuarterlyFinancialsDto[] {
  const rng = new Prng(deriveSeed(seed, 'financials'));
  const periods = fiscalQuartersEndingAt(params.endDate, params.quarters);
  const shares = BigInt(params.sharesOutstanding);

  const rows: QuarterlyFinancialsDto[] = [];
  let equity = params.openingEquity;

  for (let i = 0; i < periods.length; i++) {
    const growthFactor = Math.pow(1 + params.revenueGrowth, i);
    const jitter = 0.95 + 0.1 * rng.next(); // ±5%
    const revenue = params.baseQuarterlyRevenue * growthFactor * jitter;

    const marginJitter = 0.9 + 0.2 * rng.next(); // ±10%
    let netProfit = revenue * params.netMargin * marginJitter;

    // Deterministically force the final fiscal year loss-making if requested,
    // so the P/E-null edge case is exercised from a fixed seed.
    const isLastYear = i >= periods.length - 4;
    if (params.forceLatestLoss && isLastYear) {
      netProfit = -Math.abs(netProfit) * 0.5;
    }

    // Equity walks by retained profit (no dividends deducted here — dividends
    // are corporate actions, and A1 only requires the ratios to reconcile).
    equity += netProfit;

    const revenueDec = fromNumber(revenue, SCALE.money);
    const netProfitDec = fromNumber(netProfit, SCALE.money);
    const equityDec = fromNumber(equity, SCALE.money);
    const intangiblesDec = fromNumber(
      equity * params.intangiblesRatio,
      SCALE.money,
    );
    const borrowingsDec = fromNumber(equity * params.debtRatio, SCALE.money);
    // NTA = equity − intangibles (reported line).
    const ntaDec = fromNumber(
      equity - equity * params.intangiblesRatio,
      SCALE.money,
    );
    // EPS = net profit ÷ shares, at eps scale, exact from the emitted netProfit.
    const epsDec = divideMoneyByShares(netProfitDec, shares, SCALE.eps);

    rows.push({
      fiscalYear: periods[i].fiscalYear,
      fiscalQuarter: periods[i].fiscalQuarter,
      periodEnd: periods[i].periodEnd,
      revenue: toStringAtScale(revenueDec, SCALE.money),
      netProfit: toStringAtScale(netProfitDec, SCALE.money),
      eps: toStringAtScale(epsDec, SCALE.eps),
      equity: toStringAtScale(equityDec, SCALE.money),
      nta: toStringAtScale(ntaDec, SCALE.money),
      intangibles: toStringAtScale(intangiblesDec, SCALE.money),
      totalBorrowings: toStringAtScale(borrowingsDec, SCALE.money),
    });
  }

  return rows;
}

// ---------- dividends ----------

/**
 * Emit dividend `CorporateAction`s across the timeline: `dividendsPerYear`
 * evenly-spaced ex-dates per year, each paying `annualDividendPerShare /
 * dividendsPerYear`. Only these feed the trailing-12-month DY.
 */
function generateDividends(
  seed: number,
  params: SyntheticParams,
): CorporateActionDto[] {
  // Seeded stream reserved for future amount jitter; kept deterministic even if
  // unused so adding jitter later doesn't shift the price/financial streams.
  void new Prng(deriveSeed(seed, 'dividends'));

  const actions: CorporateActionDto[] = [];
  if (params.dividendsPerYear <= 0 || params.annualDividendPerShare <= 0) {
    return actions;
  }

  const perAction = params.annualDividendPerShare / params.dividendsPerYear;
  const perActionDec = fromNumber(perAction, SCALE.dividend);

  const years = Math.ceil(params.quarters / 4);
  const [endY, endM, endD] = params.endDate.split('-').map((s) => parseInt(s, 10));
  const monthStep = Math.max(1, Math.floor(12 / params.dividendsPerYear));

  for (let y = 0; y < years; y++) {
    for (let k = 0; k < params.dividendsPerYear; k++) {
      const year = endY - (years - 1) + y;
      const month = ((k * monthStep) % 12) + 1;
      const exDate = `${year.toString().padStart(4, '0')}-${month
        .toString()
        .padStart(2, '0')}-15`;
      // Only keep actions on/before the end date.
      if (exDate > params.endDate) continue;
      actions.push({
        type: CorporateActionType.Dividend,
        exDate,
        amount: toStringAtScale(perActionDec, SCALE.dividend),
      });
    }
  }
  void endM;
  void endD;

  // Stable order by ex-date.
  actions.sort((a, b) => (a.exDate < b.exDate ? -1 : a.exDate > b.exDate ? 1 : 0));
  return actions;
}

// ---------- snapshot ----------

/** Materialise the FundamentalsSnapshot ratios from the emitted DTOs (A1). */
function buildSnapshot(
  bars: PriceBarDto[],
  quarters: QuarterlyFinancialsDto[],
  dividends: CorporateActionDto[],
  params: SyntheticParams,
): FundamentalsSnapshotDto {
  const shares = params.sharesOutstanding.toString();
  const pe = peRatio(bars, quarters);
  const eps = ttmEps(quarters);

  return {
    sharesOutstanding: shares,
    ntaPerShare: ratioString(ntaPerShare(quarters, shares)),
    ttmEps: toStringAtScale(eps, SCALE.eps),
    ttmRevenue: moneyString(ttmRevenue(quarters)),
    ttmNetProfit: moneyString(ttmNetProfit(quarters)),
    peRatio: pe === null ? null : ratioString(pe),
    dividendYield: ratioString(dividendYield(bars, dividends)),
    pntaRatio: ratioString(pntaRatio(bars, quarters, shares)),
    roe: ratioString(roe(quarters)),
    debtToEquity: ratioString(debtToEquity(quarters)),
    psr: ratioString(psr(bars, quarters, shares)),
    consecutiveGrowthQuarters: consecutiveGrowthQuarters(quarters),
  };
}

// ---------- date + math helpers ----------

/** Divide a money Decimal by an integer share count, at a result scale. */
function divideMoneyByShares(
  money: Decimal,
  shares: bigint,
  resultScale: number,
): Decimal {
  return divide(money, fromUnits(shares, 0), resultScale);
}

/**
 * The `tradingDays` most recent weekdays on/before `endDate`, ascending. A
 * weekday proxy for Bursa trading days (no holiday calendar — synthetic data).
 */
function tradingDaysEndingAt(endDate: string, tradingDays: number): string[] {
  const dates: string[] = [];
  let d = parseIso(endDate);
  while (dates.length < tradingDays) {
    const dow = dayOfWeek(d);
    if (dow !== 0 && dow !== 6) {
      dates.push(formatIso(d));
    }
    d = addDays(d, -1);
  }
  dates.reverse();
  return dates;
}

interface FiscalQuarter {
  fiscalYear: number;
  fiscalQuarter: number;
  periodEnd: string;
}

/**
 * The `count` most recent calendar quarters ending on/before `endDate`,
 * ascending. Fiscal year = calendar year; quarter = ceil(month/3); period-end =
 * last day of the quarter's final month.
 */
function fiscalQuartersEndingAt(
  endDate: string,
  count: number,
): FiscalQuarter[] {
  const [endY, endM] = endDate.split('-').map((s) => parseInt(s, 10));
  const endQuarterIndex = endY * 4 + (Math.ceil(endM / 3) - 1);

  const out: FiscalQuarter[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const qi = endQuarterIndex - i;
    const year = Math.floor(qi / 4);
    const quarter = (qi % 4) + 1;
    const lastMonth = quarter * 3;
    const periodEnd = `${year.toString().padStart(4, '0')}-${lastMonth
      .toString()
      .padStart(2, '0')}-${lastDayOfMonth(year, lastMonth)
      .toString()
      .padStart(2, '0')}`;
    out.push({ fiscalYear: year, fiscalQuarter: quarter, periodEnd });
  }
  return out;
}

// Minimal, dependency-free UTC date arithmetic (deterministic, no TZ drift).

interface Ymd {
  y: number;
  m: number; // 1–12
  d: number; // 1–31
}

function parseIso(iso: string): Ymd {
  const [y, m, d] = iso.split('-').map((s) => parseInt(s, 10));
  return { y, m, d };
}

function formatIso(x: Ymd): string {
  return `${x.y.toString().padStart(4, '0')}-${x.m
    .toString()
    .padStart(2, '0')}-${x.d.toString().padStart(2, '0')}`;
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function lastDayOfMonth(y: number, m: number): number {
  const days = [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[m - 1];
}

function addDays(x: Ymd, delta: number): Ymd {
  let { y, m, d } = x;
  d += delta;
  while (d < 1) {
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
    d += lastDayOfMonth(y, m);
  }
  while (d > lastDayOfMonth(y, m)) {
    d -= lastDayOfMonth(y, m);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return { y, m, d };
}

/** Day of week 0=Sun..6=Sat via Sakamoto's algorithm (proleptic Gregorian). */
function dayOfWeek(x: Ymd): number {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  let y = x.y;
  if (x.m < 3) y -= 1;
  return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + t[x.m - 1] + x.d) % 7;
}
