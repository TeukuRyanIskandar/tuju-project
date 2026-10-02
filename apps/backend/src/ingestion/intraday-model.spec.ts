/**
 * Pure intraday-replay model test (spec 05, ticket 03 Testing decisions).
 *
 * "Good test = external behaviour": the tick derivation must stay bounded and
 * deterministic while moving instruments DIFFERENTLY (a market-wide wobble
 * would leave the gainers/losers boards all-tied), the intraday volume must be
 * an honest monotonic ramp of the last daily volume across the trading window,
 * and the precomputed movers boards must order the whole universe (gainers
 * %change desc, losers asc, actives by volume — no floor, no filtering) with
 * deterministic ties.
 */
import {
  MARKET_CLOSE_MINUTE_OF_DAY,
  MARKET_OPEN_MINUTE_OF_DAY,
  buildMoversBoards,
  elapsedTradingFraction,
  intradayPrice,
  intradayVolume,
  intradayWobblePhase,
  mytMinuteOfDay,
  type MoverSnapshot,
} from './intraday-model';

/** 12:00 MYT (UTC+8) — inside the trading window. */
const MIDDAY_MYT = new Date('2025-06-02T04:00:00Z');

describe('mytMinuteOfDay', () => {
  it('converts UTC to MYT minute-of-day (UTC+8, no TZ library)', () => {
    expect(mytMinuteOfDay(MIDDAY_MYT)).toBe(12 * 60);
    // 00:00 UTC = 08:00 MYT — before the open.
    expect(mytMinuteOfDay(new Date('2025-06-02T00:00:00Z'))).toBe(8 * 60);
    // 16:59 UTC = 00:59 MYT next day (minute-of-day wraps).
    expect(mytMinuteOfDay(new Date('2025-06-02T16:59:00Z'))).toBe(59);
  });
});

describe('intradayPrice', () => {
  it('stays within ±0.5% of the last close across the trading window', () => {
    const phase = intradayWobblePhase('1155');
    for (let m = MARKET_OPEN_MINUTE_OF_DAY; m <= MARKET_CLOSE_MINUTE_OF_DAY; m += 5) {
      const price = intradayPrice(2.5, m, phase);
      expect(price).toBeGreaterThanOrEqual(2.5 * 0.995);
      expect(price).toBeLessThanOrEqual(2.5 * 1.005);
    }
  });

  it('is deterministic per (minute, instrument) and moves across minutes', () => {
    const pA = intradayWobblePhase('1155');
    expect(intradayPrice(2.5, 12 * 60, pA)).toBe(intradayPrice(2.5, 12 * 60, pA));
    // Some later minute prices differ (successive ticks move).
    const later = intradayPrice(2.5, 12 * 60 + 25, pA);
    expect(later).not.toBe(intradayPrice(2.5, 12 * 60, pA));
  });

  it('moves instruments differently (per-instrument wobble phase)', () => {
    // The whole point of the phase: a market-wide wobble would make every
    // %change identical, so the gainers/losers boards would be all-ties.
    const pA = intradayWobblePhase('1155');
    const pB = intradayWobblePhase('0200');
    const a = (intradayPrice(2.5, 12 * 60, pA) / 2.5 - 1) * 100;
    const b = (intradayPrice(2.5, 12 * 60, pB) / 2.5 - 1) * 100;
    expect(a).not.toBe(b);
  });

  it('derives the phase stably from the stockCode', () => {
    expect(intradayWobblePhase('1155')).toBe(intradayWobblePhase('1155'));
    expect(intradayWobblePhase('1155')).not.toBe(intradayWobblePhase('1023'));
  });
});

describe('intradayVolume', () => {
  it('is zero at/before the open and reaches the full daily volume at the close', () => {
    expect(intradayVolume(1_000_000, MARKET_OPEN_MINUTE_OF_DAY)).toBe(0);
    expect(intradayVolume(1_000_000, MARKET_OPEN_MINUTE_OF_DAY - 1)).toBe(0);
    expect(intradayVolume(1_000_000, MARKET_CLOSE_MINUTE_OF_DAY)).toBe(1_000_000);
  });

  it('ramps monotonically through the trading window (honest cumulative volume)', () => {
    let prev = -1;
    for (let m = MARKET_OPEN_MINUTE_OF_DAY; m <= MARKET_CLOSE_MINUTE_OF_DAY; m += 5) {
      const v = intradayVolume(1_000_000, m);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(1_000_000);
      expect(Number.isInteger(v)).toBe(true);
      prev = v;
    }
  });

  it('clamps outside the window (the replay is also runnable off-hours)', () => {
    expect(intradayVolume(1_000_000, MARKET_CLOSE_MINUTE_OF_DAY + 60)).toBe(1_000_000);
    expect(elapsedTradingFraction(MARKET_OPEN_MINUTE_OF_DAY - 60)).toBe(0);
    expect(elapsedTradingFraction(MARKET_CLOSE_MINUTE_OF_DAY + 60)).toBe(1);
  });
});

/**
 * Known snapshots (hand-orderable):
 *
 * | code | live  | prev  | daily volume |
 * |-----:|------:|------:|-------------:|
 * | 1023 | 2.20  | 2.00  | 300          |
 * | 1155 | 1.98  | 2.00  | 500          |
 * | 0200 | 5.10  | 5.00  | 400          |
 *
 * %change: 1023 +10, 0200 +2, 1155 −1 → gainers [1023, 0200, 1155],
 * losers [1155, 0200, 1023]; actives (any mid-window fraction > 0) by volume
 * [1155 (500), 0200 (400), 1023 (300)].
 */
const KNOWN_SNAPSHOTS: readonly MoverSnapshot[] = [
  { stockCode: '1023', shortName: 'CIMB', livePrice: 2.2, prevClose: 2, dailyVolume: 300 },
  { stockCode: '1155', shortName: 'MAYBANK', livePrice: 1.98, prevClose: 2, dailyVolume: 500 },
  { stockCode: '0200', shortName: 'INARI', livePrice: 5.1, prevClose: 5, dailyVolume: 400 },
];

describe('buildMoversBoards', () => {
  const boards = buildMoversBoards(KNOWN_SNAPSHOTS, 12 * 60);

  it('orders gainers by %change desc and losers asc (ties by stockCode)', () => {
    expect(boards.gainers.map((e) => e.stockCode)).toEqual(['1023', '0200', '1155']);
    expect(boards.losers.map((e) => e.stockCode)).toEqual(['1155', '0200', '1023']);
    expect(boards.gainers[0]!.pctChange).toBeCloseTo(10, 6);
    expect(boards.losers[0]!.pctChange).toBeCloseTo(-1, 6);
  });

  it('orders actives by volume desc over the whole universe (no floor)', () => {
    expect(boards.actives.map((e) => e.stockCode)).toEqual(['1155', '0200', '1023']);
    // Every analysed instrument is on every board — no liquidity floor.
    for (const board of [boards.gainers, boards.losers, boards.actives]) {
      expect(board).toHaveLength(KNOWN_SNAPSHOTS.length);
    }
  });

  it('carries price/pctChange/volume per entry, price at the tick scale', () => {
    const cimb = boards.gainers.find((e) => e.stockCode === '1023')!;
    expect(cimb.shortName).toBe('CIMB');
    expect(cimb.price).toBe('2.200000');
    expect(cimb.pctChange).toBeCloseTo(10, 6);
    expect(cimb.volume).toBe(Math.floor(300 * elapsedTradingFraction(12 * 60)));
  });

  it('sorts a null %change last on gainers and losers (prev = 0 is undefined)', () => {
    const withZeroPrev: readonly MoverSnapshot[] = [
      ...KNOWN_SNAPSHOTS,
      { stockCode: '9999', shortName: 'ZERO', livePrice: 1, prevClose: 0, dailyVolume: 100 },
    ];
    const b = buildMoversBoards(withZeroPrev, 12 * 60);
    expect(b.gainers[b.gainers.length - 1]!.stockCode).toBe('9999');
    expect(b.losers[b.losers.length - 1]!.stockCode).toBe('9999');
    expect(b.gainers.find((e) => e.stockCode === '9999')!.pctChange).toBeNull();
  });

  it('breaks %change ties deterministically by stockCode', () => {
    const tied: readonly MoverSnapshot[] = [
      // All exactly +100% (float-exact: 4−2 = 2−1 = 1−0.5 in binary terms is
      // avoided by power-of-two prices) so the %change tie is a true tie.
      { stockCode: '6888', shortName: 'A', livePrice: 4, prevClose: 2, dailyVolume: 10 },
      { stockCode: '5347', shortName: 'B', livePrice: 6, prevClose: 3, dailyVolume: 20 },
      { stockCode: '0200', shortName: 'C', livePrice: 8, prevClose: 4, dailyVolume: 30 },
    ];
    // All +10%: gainers tie-break stockCode asc, actives order by volume desc.
    const b = buildMoversBoards(tied, 12 * 60);
    expect(b.gainers.map((e) => e.stockCode)).toEqual(['0200', '5347', '6888']);
    expect(b.actives.map((e) => e.stockCode)).toEqual(['0200', '5347', '6888']);
  });

  it('updates through the trading day (a later minute yields different volumes)', () => {
    const early = buildMoversBoards(KNOWN_SNAPSHOTS, MARKET_OPEN_MINUTE_OF_DAY + 60);
    const late = buildMoversBoards(KNOWN_SNAPSHOTS, MARKET_OPEN_MINUTE_OF_DAY + 240);
    expect(late.actives[0]!.volume).toBeGreaterThan(early.actives[0]!.volume);
  });
});
