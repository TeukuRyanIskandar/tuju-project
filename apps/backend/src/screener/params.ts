/**
 * Screener query-param parsing (spec 03; ticket 01).
 *
 * Same posture as `stocks/filters.ts` + `stocks/pagination.ts` (spec 02/04):
 * CLAMP/DROP, never a 400 — an anonymous free-tier browse surface is forgiving
 * of odd query strings, and the resolved values are echoed / keyed into the
 * class-2 cache so two equivalent requests (one clamped) share one entry.
 *
 * Parsing is pure (no DI): ticket 02's controller maps raw query params onto
 * the resolved {@link ScreenerQueryParams} the seam expects. Sector ids are
 * UUID-validated (a malformed id is dropped, never a Postgres cast error);
 * boards ride `parseEnumList` so `LEAP` (outside the analysed universe) is
 * dropped for free; numeric bands and booleans parse to `number | null` /
 * `boolean | null`.
 */

import { ListingBoard } from '../data/entities/enums';
import { parseEnumList } from '../stocks/filters';
import { resolvePagination, type ResolvedPage } from '../stocks/pagination';
import type {
  ScreenerFilters,
  ScreenerQueryParams,
  ScreenerSortKey,
  SortDirection,
} from './screener-query.interface';

/** Sort when `sort` is absent/unparseable — spec 03's recommended default. */
export const DEFAULT_SCREENER_SORT: ScreenerSortKey = 'pctChange';

/** Direction when `dir` is absent/unparseable (spec 03: %change desc). */
export const DEFAULT_SCREENER_DIR: SortDirection = 'desc';

/** The sortable columns (spec 03: any returned numeric column). */
export const SCREENER_SORT_KEYS: readonly ScreenerSortKey[] = [
  'close',
  'pctChange',
  'marketCap',
  'pe',
  'dy',
  'pNta',
  'roe',
  'de',
];

/** The screenerable boards — LEAP is outside the analysed universe (dropped). */
export const SCREENER_BOARDS: readonly ListingBoard[] = [
  ListingBoard.Main,
  ListingBoard.Ace,
];

/**
 * The raw query params the `GET /screener` endpoint (ticket 02) receives.
 * All optional; `undefined` = absent.
 */
export interface RawScreenerParams {
  board?: string;
  sector?: string;
  shariah?: string;
  priceMin?: string;
  priceMax?: string;
  volumeMin?: string;
  marketCapMin?: string;
  marketCapMax?: string;
  peMin?: string;
  peMax?: string;
  dyMin?: string;
  dyMax?: string;
  pNtaMin?: string;
  pNtaMax?: string;
  roeMin?: string;
  roeMax?: string;
  deMin?: string;
  deMax?: string;
  profitableYearsMin?: string;
  yoyProfitGrowthMin?: string;
  consecutiveGrowthQuartersMin?: string;
  rsi14Min?: string;
  rsi14Max?: string;
  aboveSma50?: string;
  aboveSma200?: string;
  sort?: string;
  dir?: string;
  offset?: string;
  limit?: string;
}

/**
 * The endpoint's whole `@Query()` object → the known raw params. The ONE
 * place the HTTP param-name mapping lives (ticket 02): only the 29 known
 * keys pass, and only their plain-string values — a repeated param (an
 * array) or a nested object is dropped, never a 400 (the clamp/drop
 * posture, applied before any parsing).
 */
export function rawScreenerParams(query: unknown): RawScreenerParams {
  const raw: RawScreenerParams = {};
  if (typeof query !== 'object' || query === null) return raw;
  const record = query as Record<string, unknown>;
  const keys: readonly (keyof RawScreenerParams)[] = [
    'board',
    'sector',
    'shariah',
    'priceMin',
    'priceMax',
    'volumeMin',
    'marketCapMin',
    'marketCapMax',
    'peMin',
    'peMax',
    'dyMin',
    'dyMax',
    'pNtaMin',
    'pNtaMax',
    'roeMin',
    'roeMax',
    'deMin',
    'deMax',
    'profitableYearsMin',
    'yoyProfitGrowthMin',
    'consecutiveGrowthQuartersMin',
    'rsi14Min',
    'rsi14Max',
    'aboveSma50',
    'aboveSma200',
    'sort',
    'dir',
    'offset',
    'limit',
  ];
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') raw[key] = value;
  }
  return raw;
}

/** One numeric filter param → a finite number; anything else → `null` (ignored). */
export function parseNumericFilter(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  // Number('') is 0 — an empty ?priceMax= must not become a 0 band.
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** One boolean filter param (`true`/`false`, case-insensitive) → `boolean | null`. */
export function parseBooleanFilter(raw: string | undefined): boolean | null {
  if (raw === undefined) return null;
  const value = raw.trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

/** Sort key → the allowlist member; absent/unknown → the default (`pctChange`). */
export function parseScreenerSort(raw: string | undefined): ScreenerSortKey {
  if (raw === undefined) return DEFAULT_SCREENER_SORT;
  return SCREENER_SORT_KEYS.includes(raw as ScreenerSortKey)
    ? (raw as ScreenerSortKey)
    : DEFAULT_SCREENER_SORT;
}

/** Direction → `asc`/`desc` (case-insensitive); absent/unknown → `desc`. */
export function parseScreenerDir(raw: string | undefined): SortDirection {
  if (raw === undefined) return DEFAULT_SCREENER_DIR;
  return raw.trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
}

/**
 * Comma-separated sector ids → deduped UUID list; malformed ids are dropped
 * (never a Postgres cast error), an all-invalid/absent param → `[]`.
 */
export function parseSectorIds(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  const out: string[] = [];
  for (const token of raw.split(',')) {
    const id = token.trim();
    if (UUID_PATTERN.test(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve the full filter set from raw params (drop, never 400). */
export function parseScreenerFilters(raw: RawScreenerParams): ScreenerFilters {
  return {
    boards: parseEnumList(raw.board, SCREENER_BOARDS),
    sectorIds: parseSectorIds(raw.sector),
    shariah: parseBooleanFilter(raw.shariah),
    priceMin: parseNumericFilter(raw.priceMin),
    priceMax: parseNumericFilter(raw.priceMax),
    volumeMin: parseNumericFilter(raw.volumeMin),
    marketCapMin: parseNumericFilter(raw.marketCapMin),
    marketCapMax: parseNumericFilter(raw.marketCapMax),
    peMin: parseNumericFilter(raw.peMin),
    peMax: parseNumericFilter(raw.peMax),
    dyMin: parseNumericFilter(raw.dyMin),
    dyMax: parseNumericFilter(raw.dyMax),
    pNtaMin: parseNumericFilter(raw.pNtaMin),
    pNtaMax: parseNumericFilter(raw.pNtaMax),
    roeMin: parseNumericFilter(raw.roeMin),
    roeMax: parseNumericFilter(raw.roeMax),
    deMin: parseNumericFilter(raw.deMin),
    deMax: parseNumericFilter(raw.deMax),
    profitableYearsMin: parseNumericFilter(raw.profitableYearsMin),
    yoyProfitGrowthMin: parseNumericFilter(raw.yoyProfitGrowthMin),
    consecutiveGrowthQuartersMin: parseNumericFilter(
      raw.consecutiveGrowthQuartersMin,
    ),
    rsi14Min: parseNumericFilter(raw.rsi14Min),
    rsi14Max: parseNumericFilter(raw.rsi14Max),
    aboveSma50: parseBooleanFilter(raw.aboveSma50),
    aboveSma200: parseBooleanFilter(raw.aboveSma200),
  };
}

/** Resolve one full screener query (filters + sort + clamped page window). */
export function parseScreenerQuery(raw: RawScreenerParams): ScreenerQueryParams {
  const page: ResolvedPage = resolvePagination(raw.offset, raw.limit);
  return {
    filters: parseScreenerFilters(raw),
    sort: parseScreenerSort(raw.sort),
    dir: parseScreenerDir(raw.dir),
    offset: page.offset,
    limit: page.limit,
  };
}
