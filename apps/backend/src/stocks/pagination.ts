/**
 * Pagination parsing for the stock-page list endpoints (spec 02; ticket 03).
 *
 * One policy for both disclosure lists: CLAMP, never 400 — a free-tier browse
 * surface should be forgiving of odd query strings, and the resolved values are
 * echoed in the response so the clamping is observable. The resolved values
 * also form part of the class-2 cache key, so two equivalent requests (one
 * clamped) share one cache entry.
 */

/** Page size when `limit` is absent or unparseable. */
export const DEFAULT_PAGE_LIMIT = 50;

/** Hard ceiling on `limit` (larger values are clamped, not rejected). */
export const MAX_PAGE_LIMIT = 100;

/** The resolved, always-valid page window. */
export interface ResolvedPage {
  offset: number;
  limit: number;
}

/** Parse one query param to a non-negative integer; absent/NaN/negative → fallback. */
function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

/**
 * Resolve the offset/limit query params: offset ≥ 0 (negative → 0), limit
 * default 50, hard max 100 (clamped).
 */
export function resolvePagination(
  rawOffset?: string,
  rawLimit?: string,
): ResolvedPage {
  return {
    offset: parseNonNegativeInt(rawOffset, 0),
    limit: Math.min(
      parseNonNegativeInt(rawLimit, DEFAULT_PAGE_LIMIT),
      MAX_PAGE_LIMIT,
    ),
  };
}
