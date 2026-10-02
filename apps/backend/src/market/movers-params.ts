/**
 * Param parsing for `GET /market/movers` (spec 05, ticket 04).
 *
 * House clamp/drop posture: unknown values drop to defaults; out-of-range
 * numerics clamp — a bad query string is NEVER a 400. The resolved values are
 * echoed back in the response so the clamping is observable to callers.
 */

import type { MoversBoardType } from '../ingestion/intraday-model';

/** Valid board types for the movers endpoint. */
export const MOVERS_BOARD_TYPES_SET = new Set<string>([
  'gainers',
  'losers',
  'actives',
]);

/** Default movers type when absent or unknown. */
export const DEFAULT_MOVERS_TYPE: MoversBoardType = 'gainers';

/** Default row count when `limit` is absent or un-parseable. */
export const DEFAULT_MOVERS_LIMIT = 10;

/** Hard ceiling on `limit` (larger values are clamped, not rejected). */
export const MAX_MOVERS_LIMIT = 50;

/** The resolved, always-valid movers query params. */
export interface ResolvedMoversParams {
  type: MoversBoardType;
  limit: number;
}

/** Raw query object (everything is a string or undefined from Express). */
export interface RawMoversParams {
  type?: string;
  limit?: string;
}

/** Parse one query param to a positive integer; absent/NaN/negative → fallback. */
function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

/**
 * Resolve the movers query params: type defaults to `gainers` (unknown →
 * default), limit defaults to 10 (hard max 50, clamped).
 */
export function resolveMoversParams(raw: RawMoversParams): ResolvedMoversParams {
  const type: MoversBoardType = MOVERS_BOARD_TYPES_SET.has(raw.type ?? '')
    ? (raw.type as MoversBoardType)
    : DEFAULT_MOVERS_TYPE;

  const limit = Math.min(
    parsePositiveInt(raw.limit, DEFAULT_MOVERS_LIMIT),
    MAX_MOVERS_LIMIT,
  );

  return { type, limit };
}

/**
 * Pick the movers-relevant params from an unknown query object (the single
 * home of the HTTP param-name mapping, unit-pinned).
 */
export function rawMoversParams(query: unknown): RawMoversParams {
  if (query === null || typeof query !== 'object') return {};
  const q = query as Record<string, unknown>;
  return {
    type: typeof q['type'] === 'string' ? q['type'] : undefined,
    limit: typeof q['limit'] === 'string' ? q['limit'] : undefined,
  };
}
