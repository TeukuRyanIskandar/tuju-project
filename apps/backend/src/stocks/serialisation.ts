/**
 * Pure serialisation helpers for the stock-page payload (spec 02; ticket 03).
 *
 * TypeORM `numeric`/`bigint` columns come back as strings; the payload carries
 * JS numbers. These are the only conversions — done once at this seam, with
 * null passing through untouched.
 */

/**
 * Convert a TypeORM numeric column value to a JS number; null/undefined pass
 * through as null (a nullable column stays null in the payload — e.g. a
 * loss-maker's stored P/E).
 */
export function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Number(value);
}

/**
 * %change between the two latest EOD closes: (latest − prev) / prev × 100.
 * `prev = 0` has no defined change and yields null (guard — synthetic prices
 * are never zero, but the ratio must never be NaN/Infinity).
 */
export function pctChange(latest: number, prev: number): number | null {
  if (prev === 0) return null;
  return ((latest - prev) / prev) * 100;
}
