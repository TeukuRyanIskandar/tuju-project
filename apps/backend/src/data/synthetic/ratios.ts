/**
 * Pure ratio derivation for the synthetic co-generation generator (spec 01,
 * ticket 03). Every ratio is computed **only** from emitted DTO fields (price
 * bars, quarterly financials, dividend actions, shares outstanding) using the
 * exact fixed-point primitives in {@link ./decimal}. This is the single
 * definition the generator uses to materialise the {@link FundamentalsSnapshot},
 * so the A1 reconciliation guarantee holds by construction.
 *
 * Definitions (spec 01 "Ratio definitions", apps/backend/CONTEXT.md):
 *  - P/E   = price ÷ TTM EPS; **null when TTM EPS ≤ 0**.
 *  - DY    = trailing-12-month dividend per share ÷ price.
 *  - P/NTA = price ÷ NTA/share; NTA/share = (equity − intangibles) ÷ shares.
 *  - ROE   = TTM net profit ÷ **average** equity (opening+closing over TTM).
 *  - D/E   = total borrowings ÷ latest equity.
 *  - PSR   = market cap ÷ TTM revenue; market cap = price × shares outstanding.
 *  - YoY / consecutive growth = quarter vs same quarter one year prior.
 */

import {
  Decimal,
  add,
  divide,
  fromString,
  fromUnits,
  isNegativeOrZero,
  mul,
  sub,
  toStringAtScale,
} from './decimal';
import {
  CorporateActionDto,
  PriceBarDto,
  QuarterlyFinancialsDto,
  SCALE,
} from './types';
import { CorporateActionType } from '../entities/enums';

/** Latest close as a Decimal at price scale. */
export function latestClose(bars: PriceBarDto[]): Decimal {
  if (bars.length === 0) throw new Error('latestClose: no price bars');
  return fromString(bars[bars.length - 1].close, SCALE.price);
}

/** Sum of net profit over the last 4 quarters (TTM). */
export function ttmNetProfit(quarters: QuarterlyFinancialsDto[]): Decimal {
  return sumLast(quarters, 4, (q) => fromString(q.netProfit, SCALE.money));
}

/** Sum of revenue over the last 4 quarters (TTM). */
export function ttmRevenue(quarters: QuarterlyFinancialsDto[]): Decimal {
  return sumLast(quarters, 4, (q) => fromString(q.revenue, SCALE.money));
}

/** Sum of EPS over the last 4 quarters (TTM). */
export function ttmEps(quarters: QuarterlyFinancialsDto[]): Decimal {
  return sumLast(quarters, 4, (q) => fromString(q.eps, SCALE.eps));
}

/** Latest quarter's equity. */
export function latestEquity(quarters: QuarterlyFinancialsDto[]): Decimal {
  return fromString(last(quarters).equity, SCALE.money);
}

/**
 * Average equity over the TTM window: (opening + closing) ÷ 2 where opening is
 * the equity at the start of the 4-quarter window and closing is the latest.
 */
export function averageEquity(quarters: QuarterlyFinancialsDto[]): Decimal {
  if (quarters.length < 4) throw new Error('averageEquity: need ≥ 4 quarters');
  const closing = fromString(quarters[quarters.length - 1].equity, SCALE.money);
  const opening = fromString(quarters[quarters.length - 4].equity, SCALE.money);
  return divide(add(opening, closing), fromUnits(2n, 0), SCALE.money);
}

/** NTA per share = (latest equity − latest intangibles) ÷ shares outstanding. */
export function ntaPerShare(
  quarters: QuarterlyFinancialsDto[],
  sharesOutstanding: string,
): Decimal {
  const q = last(quarters);
  const equity = fromString(q.equity, SCALE.money);
  const intangibles = fromString(q.intangibles, SCALE.money);
  const tangible = sub(equity, intangibles);
  const shares = fromUnits(BigInt(sharesOutstanding), 0);
  return divide(tangible, shares, SCALE.ratio);
}

/** P/E = latest close ÷ TTM EPS; null when TTM EPS ≤ 0. */
export function peRatio(
  bars: PriceBarDto[],
  quarters: QuarterlyFinancialsDto[],
): Decimal | null {
  const eps = ttmEps(quarters);
  if (isNegativeOrZero(eps)) return null;
  return divide(latestClose(bars), eps, SCALE.ratio);
}

/**
 * Trailing-12-month dividend per share: sum of dividend `CorporateAction`
 * amounts whose ex-date falls within 12 months of the latest bar date.
 */
export function ttmDividendPerShare(
  bars: PriceBarDto[],
  dividends: CorporateActionDto[],
): Decimal {
  const asOf = last(bars).tradeDate;
  const windowStart = shiftYears(asOf, -1);
  let total: Decimal = fromUnits(0n, SCALE.dividend);
  for (const d of dividends) {
    if (d.type !== CorporateActionType.Dividend || d.amount === null) continue;
    if (d.exDate > windowStart && d.exDate <= asOf) {
      total = add(total, fromString(d.amount, SCALE.dividend));
    }
  }
  return total;
}

/** DY = TTM dividend per share ÷ latest close. */
export function dividendYield(
  bars: PriceBarDto[],
  dividends: CorporateActionDto[],
): Decimal {
  const dps = ttmDividendPerShare(bars, dividends);
  return divide(dps, latestClose(bars), SCALE.ratio);
}

/** P/NTA = latest close ÷ NTA per share. */
export function pntaRatio(
  bars: PriceBarDto[],
  quarters: QuarterlyFinancialsDto[],
  sharesOutstanding: string,
): Decimal {
  return divide(
    latestClose(bars),
    ntaPerShare(quarters, sharesOutstanding),
    SCALE.ratio,
  );
}

/** ROE = TTM net profit ÷ average equity. */
export function roe(quarters: QuarterlyFinancialsDto[]): Decimal {
  return divide(ttmNetProfit(quarters), averageEquity(quarters), SCALE.ratio);
}

/** D/E = latest total borrowings ÷ latest equity. */
export function debtToEquity(quarters: QuarterlyFinancialsDto[]): Decimal {
  const q = last(quarters);
  return divide(
    fromString(q.totalBorrowings, SCALE.money),
    fromString(q.equity, SCALE.money),
    SCALE.ratio,
  );
}

/** PSR = market cap ÷ TTM revenue; market cap = latest close × shares. */
export function psr(
  bars: PriceBarDto[],
  quarters: QuarterlyFinancialsDto[],
  sharesOutstanding: string,
): Decimal {
  const marketCap = marketCapDecimal(bars, sharesOutstanding);
  return divide(marketCap, ttmRevenue(quarters), SCALE.ratio);
}

/** Market cap = latest close × shares outstanding (money scale). */
export function marketCapDecimal(
  bars: PriceBarDto[],
  sharesOutstanding: string,
): Decimal {
  const price = latestClose(bars);
  const shares = fromUnits(BigInt(sharesOutstanding), 0);
  // price(6) × shares(0) → scale 6; rescale to money(2).
  return mul(price, shares);
}

/**
 * Count of consecutive quarters (ending at the latest) with positive YoY
 * net-profit growth. YoY compares a quarter to the same fiscal quarter one year
 * prior (i.e. index − 4). Stops at the first non-positive delta.
 */
export function consecutiveGrowthQuarters(
  quarters: QuarterlyFinancialsDto[],
): number {
  let count = 0;
  for (let i = quarters.length - 1; i - 4 >= 0; i--) {
    const cur = fromString(quarters[i].netProfit, SCALE.money);
    const prior = fromString(quarters[i - 4].netProfit, SCALE.money);
    if (cur.units > prior.units) count++;
    else break;
  }
  return count;
}

// ---------- helpers ----------

function sumLast(
  quarters: QuarterlyFinancialsDto[],
  n: number,
  pick: (q: QuarterlyFinancialsDto) => Decimal,
): Decimal {
  if (quarters.length < n) {
    throw new Error(`sumLast: need ≥ ${n} quarters, got ${quarters.length}`);
  }
  const window = quarters.slice(quarters.length - n);
  let acc = pick(window[0]);
  for (let i = 1; i < window.length; i++) acc = add(acc, pick(window[i]));
  return acc;
}

function last<T>(arr: T[]): T {
  if (arr.length === 0) throw new Error('last: empty array');
  return arr[arr.length - 1];
}

/** Shift an ISO `YYYY-MM-DD` date by whole years, clamping Feb-29 to Feb-28. */
function shiftYears(iso: string, years: number): string {
  const [y, m, d] = iso.split('-').map((s) => parseInt(s, 10));
  const ny = y + years;
  const day = m === 2 && d === 29 ? 28 : d;
  return `${ny.toString().padStart(4, '0')}-${m
    .toString()
    .padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

/** Render a ratio Decimal at the snapshot ratio scale. */
export function ratioString(d: Decimal): string {
  return toStringAtScale(d, SCALE.ratio);
}

/** Render a money Decimal at money scale. */
export function moneyString(d: Decimal): string {
  return toStringAtScale(d, SCALE.money);
}
