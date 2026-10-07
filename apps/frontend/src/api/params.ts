/** Query-param helpers shared by the per-area query builders. */

/** Offset/limit paging; the backend clamps and echoes the resolved values. */
export interface PageParams {
  offset?: number
  limit?: number
}

/** Inclusive `YYYY-MM-DD` date window; the backend drops unparseable dates. */
export interface DateRangeParams {
  from?: string
  to?: string
}

/**
 * One-or-more enum filter -> the backend's comma-separated form. Empty or
 * absent -> `undefined` so `withQuery` omits the param.
 */
export function csv(values: readonly string[] | undefined): string | undefined {
  return values && values.length > 0 ? values.join(',') : undefined
}
