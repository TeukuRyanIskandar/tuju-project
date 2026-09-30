import { EMA, MACD, RSI, SMA } from 'trading-signals';
import { computeIndicators, week52HighLow, WEEK52_WINDOW } from './indicators';

/**
 * Indicator computation unit test (ticket 04 Testing seam — "known price series →
 * expected SMA/RSI/MACD/52-wk values").
 *
 * Pure, no DB. Asserts the worker's TS indicator step (the deliberate
 * TS-override-of-TA-Lib, ADR-0012) agrees with `trading-signals` computed
 * independently over the same series, that short series null out warm-up indicators,
 * and that the 52-week window is bounded to the last 252 closes.
 */
describe('computeIndicators', () => {
  /** A deterministic ramp+wobble series long enough to warm SMA-200. */
  function series(n: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      out.push(10 + i * 0.1 + Math.sin(i / 5) * 0.5);
    }
    return out;
  }

  it('matches trading-signals SMA/RSI/MACD computed independently', () => {
    const closes = series(300);
    const result = computeIndicators(closes);

    const sma20 = new SMA(20);
    const sma50 = new SMA(50);
    const sma200 = new SMA(200);
    const rsi = new RSI(14);
    const macd = new MACD(new EMA(12), new EMA(26), new EMA(9));
    for (const c of closes) {
      sma20.add(c);
      sma50.add(c);
      sma200.add(c);
      rsi.add(c);
      macd.add(c);
    }

    expect(result.latestClose).toBe(closes[closes.length - 1].toFixed(6));
    expect(result.sma20).toBe(sma20.getResult()!.toFixed(6));
    expect(result.sma50).toBe(sma50.getResult()!.toFixed(6));
    expect(result.sma200).toBe(sma200.getResult()!.toFixed(6));
    expect(result.rsi14).toBe(rsi.getResult()!.toFixed(6));
    expect(result.macd).toBe(macd.getResult()!.macd.toFixed(6));
    expect(result.macdSignal).toBe(macd.getResult()!.signal.toFixed(6));
  });

  it('nulls out indicators the series is too short to warm', () => {
    // 30 closes: warms SMA-20 but not SMA-50 or SMA-200.
    const result = computeIndicators(series(30));
    expect(result.sma20).not.toBeNull();
    expect(result.sma50).toBeNull();
    expect(result.sma200).toBeNull();
  });

  it('computes 52-week high/low over the last 252 closes only', () => {
    // A dip near the start (outside the 252 window) must NOT be the 52-wk low.
    const closes = series(300);
    closes[0] = 1; // extreme early low, index 0 < (300-252)=48 → excluded
    const { high, low } = week52HighLow(closes);

    const window = closes.slice(closes.length - WEEK52_WINDOW);
    expect(high).toBe(Math.max(...window));
    expect(low).toBe(Math.min(...window));
    expect(low).not.toBe(1); // the early dip is outside the window
  });

  it('throws on an empty series', () => {
    expect(() => computeIndicators([])).toThrow(/empty/);
  });
});
