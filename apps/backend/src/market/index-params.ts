/**
 * Param parsing for `GET /market/indices/:id/series` (spec 05, ticket 05).
 *
 * The `range` param is the deliberate precedent for the still-foggy general
 * OHLC series endpoints (spec 05 Further Notes). House clamp/drop posture:
 * unknown values drop to the default `'1y'` — never a 400.
 *
 * The lookback cutoff is deliberately NOT anchored to the wall clock: the
 * synthetic backfill ends at a fixed historical date, so `now - 365d` would
 * drift out of the stored series entirely as real time passes (and `1m` would
 * go empty long before `all` does). `seriesSinceDate` anchors to the series'
 * OWN latest stored `levelDate` instead — the same posture a real licensed
 * series needs anyway (a holiday-shortened week must not make `1m` empty).
 */

/** Valid range values for the index series endpoint. */
export type IndexSeriesRange = '1m' | '3m' | '6m' | '1y' | '3y' | '5y' | 'all';

/** Default range when absent or unknown. */
export const DEFAULT_SERIES_RANGE: IndexSeriesRange = '1y';

/** Ordered tuple of valid range strings (for exhaustive checks). */
export const INDEX_SERIES_RANGES: readonly IndexSeriesRange[] = [
  '1m',
  '3m',
  '6m',
  '1y',
  '3y',
  '5y',
  'all',
];

const SERIES_RANGES_SET = new Set<string>(INDEX_SERIES_RANGES);

/**
 * Calendar-day lookback for each range; `null` = no date filter (`'all'`).
 * These are approximate calendar days (not trading days), consistent with
 * how every charting service implements "1Y" etc.
 */
export const RANGE_DAYS: Record<IndexSeriesRange, number | null> = {
  '1m': 30,
  '3m': 90,
  '6m': 180,
  '1y': 365,
  '3y': 1095,
  '5y': 1825,
  all: null,
};

/** The resolved, always-valid series range (the lookback, not yet a date). */
export interface ResolvedSeriesRange {
  /** The canonical range string (echoed in the response). */
  range: IndexSeriesRange;
  /** Calendar-day lookback for `range`; `null` for `'all'` (no date filter). */
  days: number | null;
}

/** Resolve the range query param: unknown/absent → `'1y'`. */
export function resolveSeriesRange(raw: string | undefined): ResolvedSeriesRange {
  const range: IndexSeriesRange = SERIES_RANGES_SET.has(raw ?? '')
    ? (raw as IndexSeriesRange)
    : DEFAULT_SERIES_RANGE;
  return { range, days: RANGE_DAYS[range] };
}

/**
 * Derive the `sinceDate` cutoff (ISO `YYYY-MM-DD`) from the SERIES' OWN latest
 * stored `levelDate` — not the wall clock — so the range stays meaningful
 * regardless of how far the stored series is from "today" (the synthetic
 * backfill's fixed end date, or a real feed with its own trading calendar).
 * `null` days (`'all'`) or no stored series yet (`latestLevelDate === null`)
 * both mean "no cutoff".
 */
export function seriesSinceDate(
  latestLevelDate: string | null,
  days: number | null,
): string | null {
  if (days === null || latestLevelDate === null) return null;
  const cutoff = new Date(`${latestLevelDate}T00:00:00.000Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return cutoff.toISOString().slice(0, 10);
}
