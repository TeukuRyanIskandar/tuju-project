const SERIES_INTERVAL = '1d' as const;
const SERIES_RANGE = '2y' as const;
/** Calendar-day lookback for the PoC-fixed `range=2y` series window. */
export const STOCK_SERIES_RANGE_DAYS = 730;

/** `GET /stocks/:code/series` accepts only the PoC-fixed `interval=1d` / `range=2y`. */
export function isStockSeriesQuery(
  interval: string | undefined,
  range: string | undefined,
): boolean {
  const resolvedInterval = interval ?? SERIES_INTERVAL;
  const resolvedRange = range ?? SERIES_RANGE;
  return resolvedInterval === SERIES_INTERVAL && resolvedRange === SERIES_RANGE;
}
