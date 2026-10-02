/**
 * Pure intraday-replay model (spec 05, ticket 03) — the tick, volume and
 * movers-board derivation behind the 5-min Redis-only replay.
 *
 * Everything is **deterministic and time-derived** (no RNG state, no wall
 * clock, no Redis/Postgres/TypeORM): the same `now` yields byte-identical
 * ticks and boards, so the replay stays replayable and the boards are
 * integration-pinnable. The per-instrument wobble phase is derived from the
 * same stable per-`stockCode` seed the synthetic generator uses — a single
 * market-wide wobble would move every instrument by the SAME %change and
 * leave the gainers/losers boards all-tied, so the phase is what makes the
 * boards meaningful.
 *
 * The market window constants here are the single source of truth for the
 * 09:00–16:45 MYT guard (`IngestionScheduler.isMarketHours`) AND the intraday
 * volume ramp — the guard and the boards provably share one window.
 */

import { pctChange } from '../stocks/serialisation';
import { instrumentSeed, SYNTHETIC_BASE_SEED } from './reference-universe';

/** Bursa continuous-trading open (MYT minute-of-day): 09:00. */
export const MARKET_OPEN_MINUTE_OF_DAY = 9 * 60;

/** Bursa continuous-trading close (MYT minute-of-day): 16:45. */
export const MARKET_CLOSE_MINUTE_OF_DAY = 16 * 60 + 45;

/** Minute-of-day in MYT (UTC+8) — the market-local time base the replay reads. */
export function mytMinuteOfDay(now: Date): number {
  // Convert to MYT without a TZ library (the scheduler-guard posture).
  const myt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return myt.getUTCHours() * 60 + myt.getUTCMinutes();
}

/** Deterministic per-instrument wobble phase (radians), stable per stockCode. */
export function intradayWobblePhase(stockCode: string): number {
  return ((instrumentSeed(SYNTHETIC_BASE_SEED, stockCode) % 360) * Math.PI) / 180;
}

/** Bounded intraday wobble (±0.5%) at a market-local minute for one instrument. */
export function intradayWobble(minutes: number, phase: number): number {
  return Math.sin(minutes / 30 + phase) * 0.005;
}

/** Live tick price for one instrument: last EOD close × (1 + wobble). */
export function intradayPrice(
  lastClose: number,
  minutes: number,
  phase: number,
): number {
  return lastClose * (1 + intradayWobble(minutes, phase));
}

/** Fraction of the trading window elapsed at a market-local minute, clamped 0–1. */
export function elapsedTradingFraction(minutes: number): number {
  const span = MARKET_CLOSE_MINUTE_OF_DAY - MARKET_OPEN_MINUTE_OF_DAY;
  const elapsed = Math.min(
    Math.max(minutes - MARKET_OPEN_MINUTE_OF_DAY, 0),
    span,
  );
  return elapsed / span;
}

/**
 * Cumulative intraday volume so far: the last daily volume ramped by the
 * elapsed trading fraction (an honest monotonic "day's volume to now", not
 * noise). Actives ordering therefore follows the daily volumes; the board
 * VALUES still grow on every tick through the window.
 */
export function intradayVolume(dailyVolume: number, minutes: number): number {
  return Math.floor(dailyVolume * elapsedTradingFraction(minutes));
}

/** The three precomputed movers boards (spec 05 option A: no floor). */
export type MoversBoardType = 'gainers' | 'losers' | 'actives';

export const MOVERS_BOARD_TYPES: readonly MoversBoardType[] = [
  'gainers',
  'losers',
  'actives',
];

/** One analysed-universe instrument the board builder reads (all pure input). */
export interface MoverSnapshot {
  readonly stockCode: string;
  readonly shortName: string;
  /** The instrument's live tick price (what the per-instrument tick holds). */
  readonly livePrice: number;
  /** The last EOD close — the %change basis. */
  readonly prevClose: number;
  /** The last daily bar's volume — the intraday volume ramp's full-day figure. */
  readonly dailyVolume: number;
}

/** One precomputed movers-board row (what the read endpoint serves). */
export interface MoverEntry {
  readonly stockCode: string;
  readonly shortName: string;
  /** Live tick price at the board's tick, numeric(18,6) scale string. */
  readonly price: string;
  /** (live − prevClose) / prevClose × 100; null when prevClose = 0 (undefined). */
  readonly pctChange: number | null;
  /** Cumulative intraday volume at the board's tick. */
  readonly volume: number;
}

/** The three boards, each the whole analysed universe in its board order. */
export interface MoversBoards {
  readonly gainers: readonly MoverEntry[];
  readonly losers: readonly MoverEntry[];
  readonly actives: readonly MoverEntry[];
}

/**
 * Precompute the three movers boards over the WHOLE analysed universe —
 * gainers by %change desc, losers by %change asc, actives by volume desc
 * (spec 05 option A: no liquidity/market-cap floor, no filtering) — so the
 * read endpoint is a pure slice of a sorted board. Null %change rows (a
 * zero prev close) sort last on both %change boards; every tie breaks by
 * `stockCode` asc so the order is fully deterministic.
 */
export function buildMoversBoards(
  snapshots: readonly MoverSnapshot[],
  minutes: number,
): MoversBoards {
  const entries: MoverEntry[] = snapshots.map((s) => ({
    stockCode: s.stockCode,
    shortName: s.shortName,
    price: s.livePrice.toFixed(6),
    pctChange: pctChange(s.livePrice, s.prevClose),
    volume: intradayVolume(s.dailyVolume, minutes),
  }));
  return {
    gainers: [...entries].sort(compareGainers),
    losers: [...entries].sort(compareLosers),
    actives: [...entries].sort(compareActives),
  };
}

/** `stockCode` asc — the deterministic tiebreak on every board. */
function byStockCode(a: MoverEntry, b: MoverEntry): number {
  return a.stockCode < b.stockCode ? -1 : a.stockCode > b.stockCode ? 1 : 0;
}

/** Gainers: %change desc, nulls last (an undefined change is not a "top" row). */
function compareGainers(a: MoverEntry, b: MoverEntry): number {
  if (a.pctChange === null || b.pctChange === null) {
    if (a.pctChange === null && b.pctChange === null) return byStockCode(a, b);
    return a.pctChange === null ? 1 : -1;
  }
  return b.pctChange - a.pctChange || byStockCode(a, b);
}

/** Losers: %change asc, nulls last. */
function compareLosers(a: MoverEntry, b: MoverEntry): number {
  if (a.pctChange === null || b.pctChange === null) {
    if (a.pctChange === null && b.pctChange === null) return byStockCode(a, b);
    return a.pctChange === null ? 1 : -1;
  }
  return a.pctChange - b.pctChange || byStockCode(a, b);
}

/** Actives: cumulative intraday volume desc. */
function compareActives(a: MoverEntry, b: MoverEntry): number {
  return b.volume - a.volume || byStockCode(a, b);
}
