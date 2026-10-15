import type { ScreenerQueryParams } from '../screener/screener-query.interface';
import {
  BRIEF_CACHE_PREFIX,
  DISCLOSURES_CACHE_PREFIX,
  MARKET_CACHE_PREFIX,
  PROSPECTUS_CACHE_PREFIX,
  SCREENER_CACHE_PREFIX,
  SEARCH_CACHE_PREFIX,
  STOCKS_CACHE_PREFIX,
} from './cache-keys';

/**
 * One named domain read: what a reader hands `ReadModelCache.read`. Opaque to
 * callers — they build it with {@link ReadModelReads}, never by hand.
 */
export interface ReadModelRead {
  readonly key: string;
}

/** Which stock-analysis read: the TA or the FA envelope. */
export type StockAnalysisKind = 'technical' | 'fundamental';

/** A paged list query (offset/limit are the RESOLVED values). */
interface Page {
  offset: number;
  limit: number;
}

/** The announcements-feed shaped query (market feed + dealings view). */
interface FeedQuery extends Page {
  companyCode?: string;
  from: Date | null;
  to: Date | null;
}

const read = (key: string): ReadModelRead => ({ key });

/** Order-insensitive list fragment: sorted, comma-joined; empty → ``. */
const listFragment = (values: readonly string[]): string =>
  [...values].sort().join(',');

/** `true`/`false`; `null` (no constraint) → `` — one unambiguous fragment. */
const boolFragment = (value: boolean | null): string =>
  value === null ? '' : String(value);

/** One resolved number → its string form; `null` (no constraint) → ``. */
const numFragment = (value: number | null): string =>
  value === null ? '' : String(value);

/** ISO `YYYY-MM-DD` of a UTC-midnight date; null → ``. */
const dayFragment = (date: Date | null): string =>
  date === null ? '' : date.toISOString().slice(0, 10);

const feed = (
  name: 'announcements' | 'dealings',
  categories: readonly string[],
  q: FeedQuery,
): ReadModelRead =>
  read(
    `${DISCLOSURES_CACHE_PREFIX}${name}:${listFragment(categories)}:${q.companyCode ?? ''}:${dayFragment(q.from)}:${dayFragment(q.to)}:${q.offset}:${q.limit}`,
  );

/** The one cached read of a stock's analysis envelope (shared with the change table). */
export const stockAnalysisKey = (
  stockCode: string,
  kind: StockAnalysisKind,
): string => `${STOCKS_CACHE_PREFIX}${stockCode}:analysis:${kind}`;

/** Prefix of every cached page of one stock's announcements list. */
export const stockAnnouncementsPrefix = (stockCode: string): string =>
  `${STOCKS_CACHE_PREFIX}${stockCode}:announcements:`;

/** Prefix of every cached read of one prospectus. */
export const prospectusPrefix = (prospectusId: string): string =>
  `${PROSPECTUS_CACHE_PREFIX}${prospectusId}:`;

/**
 * The catalogue of cached domain reads — the ONLY place read-model cache keys
 * are built. Each builder normalises its query (sorted lists, resolved
 * defaults, ISO days) so equivalent requests share one entry.
 */
export const ReadModelReads = {
  // ─── /search ───────────────────────────────────────────────────────────
  /** Case-insensitive on the (already normalised) query. */
  search: (query: string, limit: number): ReadModelRead =>
    read(`${SEARCH_CACHE_PREFIX}${query.toLowerCase()}:${limit}`),

  // ─── /stocks/:code ─────────────────────────────────────────────────────
  stockCore: (stockCode: string): ReadModelRead =>
    read(`${STOCKS_CACHE_PREFIX}${stockCode}:core`),

  stockAnnouncements: (
    stockCode: string,
    categories: readonly string[],
    page: Page,
  ): ReadModelRead =>
    read(
      `${stockAnnouncementsPrefix(stockCode)}${listFragment(categories)}:${page.offset}:${page.limit}`,
    ),

  stockCorporateActions: (
    stockCode: string,
    types: readonly string[],
    page: Page,
  ): ReadModelRead =>
    read(
      `${STOCKS_CACHE_PREFIX}${stockCode}:corporate-actions:${listFragment(types)}:${page.offset}:${page.limit}`,
    ),

  /**
   * The TA/FA envelope, `stale` already promoted. Invalidated by
   * `stockAnalysisChanged` (pending, land, fail) and, via the `cache:stocks:`
   * sweep, by `eodIngested` / `purged` (a new close can make it stale).
   */
  stockAnalysis: (stockCode: string, kind: StockAnalysisKind): ReadModelRead =>
    read(stockAnalysisKey(stockCode, kind)),

  // ─── disclosures ───────────────────────────────────────────────────────
  marketAnnouncements: (
    categories: readonly string[],
    query: FeedQuery,
  ): ReadModelRead => feed('announcements', categories, query),

  /** The dealings view (fixed `SHAREHOLDING_CHANGE` category). */
  dealings: (categories: readonly string[], query: FeedQuery): ReadModelRead =>
    feed('dealings', categories, query),

  /** `window` is the RESOLVED ISO-day window. */
  corporateActionCalendar: (
    window: { from: string; to: string },
    types: readonly string[],
    companyCode: string | undefined,
  ): ReadModelRead =>
    read(
      `${DISCLOSURES_CACHE_PREFIX}calendar:corporate-actions:${window.from}:${window.to}:${listFragment(types)}:${companyCode ?? ''}`,
    ),

  resultsCalendar: (query: {
    from: Date | null;
    to: Date | null;
    companyCode?: string;
  }): ReadModelRead =>
    read(
      `${DISCLOSURES_CACHE_PREFIX}calendar:results:${dayFragment(query.from)}:${dayFragment(query.to)}:${query.companyCode ?? ''}`,
    ),

  /** `companyCode` omitted = market-level news. */
  news: (query: Page & { companyCode?: string }): ReadModelRead =>
    read(
      `${DISCLOSURES_CACHE_PREFIX}news:${query.companyCode ?? 'market'}:${query.offset}:${query.limit}`,
    ),

  // ─── screener ──────────────────────────────────────────────────────────
  /**
   * One RESOLVED screen: every filter field in a fixed order, then
   * sort/dir/offset/limit at their resolved values — so an explicit default ≡
   * the omitted param, a clamped limit ≡ its clamp, a rotated list ≡ sorted.
   */
  screen: (params: ScreenerQueryParams): ReadModelRead => {
    const f = params.filters;
    return read(
      `${SCREENER_CACHE_PREFIX}${[
        'screen',
        listFragment(f.boards),
        listFragment(f.sectorIds),
        boolFragment(f.shariah),
        numFragment(f.priceMin),
        numFragment(f.priceMax),
        numFragment(f.volumeMin),
        numFragment(f.marketCapMin),
        numFragment(f.marketCapMax),
        numFragment(f.peMin),
        numFragment(f.peMax),
        numFragment(f.dyMin),
        numFragment(f.dyMax),
        numFragment(f.pNtaMin),
        numFragment(f.pNtaMax),
        numFragment(f.roeMin),
        numFragment(f.roeMax),
        numFragment(f.deMin),
        numFragment(f.deMax),
        numFragment(f.profitableYearsMin),
        numFragment(f.yoyProfitGrowthMin),
        numFragment(f.consecutiveGrowthQuartersMin),
        numFragment(f.rsi14Min),
        numFragment(f.rsi14Max),
        boolFragment(f.aboveSma50),
        boolFragment(f.aboveSma200),
        params.sort,
        params.dir,
        String(params.offset),
        String(params.limit),
      ].join(':')}`,
    );
  },

  /** The screener fields advertisement (one entry). */
  screenerFields: (): ReadModelRead => read(`${SCREENER_CACHE_PREFIX}fields`),

  // ─── market overview ───────────────────────────────────────────────────
  /**
   * The WHOLE sorted EOD movers board for one type (class-2 outside-hours
   * fallback); `limit` is a read-time slice, so it is not in the key. The
   * in-hours board is class 3 (`intraday:movers:*`), not this cache.
   */
  moversEod: (type: string): ReadModelRead =>
    read(`${MARKET_CACHE_PREFIX}movers:eod:${type}`),

  indices: (): ReadModelRead => read(`${MARKET_CACHE_PREFIX}indices`),

  indexSeries: (indexId: string, range: string): ReadModelRead =>
    read(`${MARKET_CACHE_PREFIX}indices:${indexId}:series:${range}`),

  // ─── showcase job read models ──────────────────────────────────────────
  latestMarketBrief: (): ReadModelRead => read(`${BRIEF_CACHE_PREFIX}latest`),

  prospectusAtAGlance: (prospectusId: string): ReadModelRead =>
    read(`${prospectusPrefix(prospectusId)}at-a-glance`),

  prospectusArtifact: (prospectusId: string): ReadModelRead =>
    read(`${prospectusPrefix(prospectusId)}artifact`),
} as const;
