/**
 * TS indicator computation (spec 01 "Indicators in TypeScript"; ticket 04, ADR-0012).
 *
 * Computes SMA-20/50/200, RSI-14 and MACD (12/26/9) over a chronological close
 * series with the `trading-signals` library, plus the 52-week high/low over the
 * last 252 trading days. This is the deliberate **TS-indicators-override-of-TA-Lib**
 * (spec 01): precision is meaningless on synthetic data, the whole demo ingestion
 * stays one language, and Python stays out of the free-tier ingestion path.
 *
 * Pure computation — no DB, no wall clock. The worker's {@link IndicatorService}
 * feeds it a close series and persists the result as one latest
 * {@link IndicatorSnapshot} per instrument. Values are returned as fixed-scale
 * numeric strings matching the entity `numeric(18,6)` columns (or null when the
 * series is too short to warm the indicator — e.g. SMA-200 needs ≥ 200 closes).
 */

import { EMA, MACD, RSI, SMA } from 'trading-signals';

/** Trailing window (trading days) the 52-week high/low is taken over. */
export const WEEK52_WINDOW = 252;

/** Scale of the indicator `numeric(18,6)` columns (matches the entity). */
const INDICATOR_SCALE = 6;

/** MACD parameters (standard 12/26/9). */
const MACD_SHORT = 12;
const MACD_LONG = 26;
const MACD_SIGNAL = 9;

/** The computed latest indicator values for one instrument (all as DB strings). */
export interface IndicatorValues {
  latestClose: string;
  sma20: string | null;
  sma50: string | null;
  sma200: string | null;
  rsi14: string | null;
  macd: string | null;
  macdSignal: string | null;
  week52High: string | null;
  week52Low: string | null;
}

/** Render a JS number at the indicator column scale (half-up), or null. */
function toScale(value: number | null | undefined): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return value.toFixed(INDICATOR_SCALE);
}

/**
 * Feed a chronological (oldest→newest) close series through an
 * `IndicatorSeries`-shaped indicator and return its latest stable result, or
 * null if the series never warmed it.
 */
function lastStable(
  closes: readonly number[],
  indicator: { add(price: number): number | null; isStable: boolean; getResult(): number | null },
): number | null {
  for (const close of closes) indicator.add(close);
  return indicator.isStable ? indicator.getResult() : null;
}

/**
 * Compute the latest indicator snapshot values from a chronological close series.
 *
 * @param closes closes oldest→newest (the worker passes `PriceBar.close` ordered
 *               by `tradeDate ASC`). Must be non-empty.
 */
export function computeIndicators(closes: readonly number[]): IndicatorValues {
  if (closes.length === 0) {
    throw new Error('computeIndicators: empty close series');
  }

  const latestClose = closes[closes.length - 1];

  const sma20 = lastStable(closes, new SMA(20));
  const sma50 = lastStable(closes, new SMA(50));
  const sma200 = lastStable(closes, new SMA(200));
  const rsi14 = lastStable(closes, new RSI(14));

  // MACD returns a { macd, signal, histogram } object; extract macd + signal.
  const macdIndicator = new MACD(
    new EMA(MACD_SHORT),
    new EMA(MACD_LONG),
    new EMA(MACD_SIGNAL),
  );
  let macdResult: { macd: number; signal: number } | null = null;
  for (const close of closes) macdIndicator.add(close);
  if (macdIndicator.isStable) {
    const r = macdIndicator.getResult();
    if (r) macdResult = { macd: r.macd, signal: r.signal };
  }

  const { high, low } = week52HighLow(closes);

  return {
    latestClose: toScale(latestClose)!,
    sma20: toScale(sma20),
    sma50: toScale(sma50),
    sma200: toScale(sma200),
    rsi14: toScale(rsi14),
    macd: macdResult ? toScale(macdResult.macd) : null,
    macdSignal: macdResult ? toScale(macdResult.signal) : null,
    week52High: toScale(high),
    week52Low: toScale(low),
  };
}

/**
 * 52-week high/low over the last {@link WEEK52_WINDOW} closes (a plain window over
 * the close series). The worker also derives these from a SQL window over the last
 * 252 trading days; this pure fallback keeps the computation testable in isolation
 * and agrees with the SQL result on the same window.
 */
export function week52HighLow(closes: readonly number[]): {
  high: number;
  low: number;
} {
  const window = closes.slice(Math.max(0, closes.length - WEEK52_WINDOW));
  let high = window[0];
  let low = window[0];
  for (const c of window) {
    if (c > high) high = c;
    if (c < low) low = c;
  }
  return { high, low };
}
