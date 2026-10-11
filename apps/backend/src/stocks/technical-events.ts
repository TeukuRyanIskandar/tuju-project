import type { IndicatorSnapshot } from '../data/entities/indicator-snapshot.entity';
import type { PriceBar } from '../data/entities/price-bar.entity';
import { toNumber } from './serialisation';
import type { TechnicalEventId } from '@tuju/contracts';

export interface TechnicalEventValue {
  [key: string]: number | string | boolean | null;
}

export interface TechnicalEvent {
  id: TechnicalEventId;
  label: string;
  fired: boolean;
  values: TechnicalEventValue;
  at: string;
}

/**
 * Compute all 7 technical events from stored indicator snapshot + price bars.
 * Pure function — no DB access, no re-computation.
 *
 * @param snap IndicatorSnapshot (all numeric fields come as TypeORM strings)
 * @param latestCloseDay Calendar date (YYYY-MM-DD) of the latest EOD close
 * @param prevBar Previous trading day PriceBar or null (for broke_swing_high check)
 * @returns Array of exactly 7 TechnicalEvent objects (one per id, fired: true/false)
 */
export function computeTechnicalEvents(
  snap: IndicatorSnapshot,
  latestCloseDay: string,
  prevBar: PriceBar | null,
): TechnicalEvent[] {
  const latestClose = toNumber(snap.latestClose);
  const sma20 = snap.sma20 ? toNumber(snap.sma20) : null;
  const sma50 = snap.sma50 ? toNumber(snap.sma50) : null;
  const sma200 = snap.sma200 ? toNumber(snap.sma200) : null;
  const rsi14 = snap.rsi14 ? toNumber(snap.rsi14) : null;
  const macd = snap.macd ? toNumber(snap.macd) : null;
  const macdSignal = snap.macdSignal ? toNumber(snap.macdSignal) : null;
  const week52High = snap.week52High ? toNumber(snap.week52High) : null;
  const week52Low = snap.week52Low ? toNumber(snap.week52Low) : null;

  const prevClose = prevBar ? toNumber(prevBar.close) : null;

  const events: TechnicalEvent[] = [];

  // ma_cross_20_50: SMA-20 above SMA-50
  events.push({
    id: 'ma_cross_20_50',
    label: 'SMA-20 crossed above SMA-50',
    fired: sma20 !== null && sma50 !== null && sma20 > sma50,
    values: {
      sma20: sma20 ?? null,
      sma50: sma50 ?? null,
    },
    at: latestCloseDay,
  });

  // ma_cross_50_200: SMA-50 above SMA-200
  events.push({
    id: 'ma_cross_50_200',
    label: 'SMA-50 crossed above SMA-200',
    fired: sma50 !== null && sma200 !== null && sma50 > sma200,
    values: {
      sma50: sma50 ?? null,
      sma200: sma200 ?? null,
    },
    at: latestCloseDay,
  });

  // price_vs_sma: Close above SMA-50
  events.push({
    id: 'price_vs_sma',
    label: 'Close above SMA-50',
    fired: latestClose !== null && sma50 !== null && latestClose > sma50,
    values: {
      close: latestClose ?? null,
      sma50: sma50 ?? null,
    },
    at: latestCloseDay,
  });

  // rsi_band: RSI in overbought (>70), oversold (<30), or mid band
  let rsiBand = 'mid';
  let rsiFired = rsi14 !== null;
  if (rsi14 !== null) {
    if (rsi14 > 70) {
      rsiBand = 'overbought';
    } else if (rsi14 < 30) {
      rsiBand = 'oversold';
    }
  }
  events.push({
    id: 'rsi_band',
    label:
      rsiBand === 'overbought'
        ? 'RSI entered overbought territory (> 70)'
        : rsiBand === 'oversold'
          ? 'RSI entered oversold territory (< 30)'
          : 'RSI-14 in mid band',
    fired: rsiFired,
    values: {
      rsi: rsi14 ?? null,
      band: rsiBand,
    },
    at: latestCloseDay,
  });

  // macd_cross: MACD line above signal
  events.push({
    id: 'macd_cross',
    label: 'MACD line crossed above signal line',
    fired: macd !== null && macdSignal !== null && macd > macdSignal,
    values: {
      line: macd ?? null,
      signal: macdSignal ?? null,
    },
    at: latestCloseDay,
  });

  // week52_proximity: Close within 5% of 52-week high
  let pctFromHigh: number | null = null;
  if (week52High !== null && latestClose !== null && week52High !== 0) {
    pctFromHigh = ((latestClose - week52High) / week52High) * 100;
  }
  const fired52 =
    week52High !== null &&
    latestClose !== null &&
    latestClose >= week52High * 0.95;
  events.push({
    id: 'week52_proximity',
    label: 'Close within 5% of 52-week high',
    fired: fired52,
    values: {
      close: latestClose ?? null,
      week52High: week52High ?? null,
      pctFromHigh: pctFromHigh,
    },
    at: latestCloseDay,
  });

  // broke_swing_high: Latest close > prior close
  const firedSwingHigh =
    latestClose !== null && prevClose !== null && latestClose > prevClose;
  events.push({
    id: 'broke_swing_high',
    label: 'Broke prior swing high',
    fired: firedSwingHigh,
    values: {
      swingHigh: prevClose ?? null,
      close: latestClose ?? null,
    },
    at: latestCloseDay,
  });

  return events;
}
