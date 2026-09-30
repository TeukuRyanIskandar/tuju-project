/**
 * Ambient declaration for `trading-signals` (ticket 04, ADR-0012).
 *
 * `trading-signals` v7 ships a dual ESM/CJS build whose types live only under the
 * package `exports` map (`require` → `dist/index.d.cts`). The backend's tsconfig
 * uses classic `moduleResolution: "Node"` (node10), which does not read conditional
 * `exports` types — so it can only see the `.d.mts` and errors. Rather than change
 * the shared tsconfig (which governs the committed build), we declare the small
 * surface the worker's indicator step uses. The CJS runtime entry
 * (`dist/index.cjs`) is what `require('trading-signals')` loads, matching this shape.
 */
declare module 'trading-signals' {
  /** Base shape shared by the indicators used here. */
  interface IndicatorSeriesLike {
    readonly isStable: boolean;
    add(input: number): number | null;
    getResult(): number | null;
  }

  /** Simple moving average over `interval` periods. */
  export class SMA implements IndicatorSeriesLike {
    constructor(interval: number);
    readonly isStable: boolean;
    add(input: number): number | null;
    getResult(): number | null;
  }

  /** Exponential moving average over `interval` periods (MACD building block). */
  export class EMA implements IndicatorSeriesLike {
    constructor(interval: number);
    readonly isStable: boolean;
    add(input: number): number | null;
    getResult(): number | null;
  }

  /** Relative strength index over `interval` periods. */
  export class RSI implements IndicatorSeriesLike {
    constructor(interval: number);
    readonly isStable: boolean;
    add(input: number): number | null;
    getResult(): number | null;
  }

  /** MACD result triple. */
  export interface MACDResult {
    histogram: number;
    macd: number;
    signal: number;
  }

  /** Moving-average convergence/divergence built from short/long/signal MAs. */
  export class MACD {
    constructor(short: EMA, long: EMA, signal: EMA);
    readonly isStable: boolean;
    add(input: number): MACDResult | null;
    getResult(): MACDResult | null;
  }
}
