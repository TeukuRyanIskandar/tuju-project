import {
  BRIEF_CACHE_PREFIX,
  DISCLOSURES_CACHE_PREFIX,
  MARKET_CACHE_PREFIX,
  SCREENER_CACHE_PREFIX,
  SEARCH_CACHE_PREFIX,
  STOCKS_CACHE_PREFIX,
} from './cache-keys';
import {
  prospectusPrefix,
  stockAnalysisKey,
  stockAnnouncementsPrefix,
  type StockAnalysisKind,
} from './read-model-reads';

/**
 * A domain change a writer announces to `ReadModelCache.changed` AFTER its
 * write commits. Writers say what happened; {@link invalidationPrefixesFor}
 * decides which cached reads that makes stale.
 */
export type ReadModelChange =
  /** The nightly EOD ingest (or `ingest-klci`) committed new prices/fundamentals/disclosures/news. */
  | { kind: 'eodIngested' }
  /** The decision-B purge removed synthetic/aggregator rows. */
  | { kind: 'purged' }
  /** An AI summary landed on one announcement (`stockCodes`: its company's instruments). */
  | {
      kind: 'announcementSummarised';
      announcementId: string;
      stockCodes: readonly string[];
    }
  /** A TA/FA row changed (pending on enqueue, ready/facts-only on land, failed). */
  | { kind: 'stockAnalysisChanged'; stockCode: string; analysis: StockAnalysisKind }
  /** A daily market brief landed. */
  | { kind: 'marketBriefLanded' }
  /** A prospectus analysis landed. */
  | { kind: 'prospectusAnalysed'; prospectusId: string };

type ChangeOf<K extends ReadModelChange['kind']> = Extract<
  ReadModelChange,
  { kind: K }
>;

/**
 * What the bulk-data writers (ingest, purge) make stale: every EOD/disclosure-
 * derived read. The brief and prospectus reads are deliberately absent — they
 * change only when their own job lands, never because of an ingest/purge.
 */
const BULK_DATA_PREFIXES = [
  SEARCH_CACHE_PREFIX,
  STOCKS_CACHE_PREFIX,
  DISCLOSURES_CACHE_PREFIX,
  SCREENER_CACHE_PREFIX,
  MARKET_CACHE_PREFIX,
] as const;

/** The event → prefixes table. Exhaustive over `ReadModelChange['kind']`. */
const INVALIDATES: {
  [K in ReadModelChange['kind']]: (change: ChangeOf<K>) => readonly string[];
} = {
  eodIngested: () => BULK_DATA_PREFIXES,
  purged: () => BULK_DATA_PREFIXES,
  // Reads that carry `aiSummary`: the market feed, the dealings view (same
  // rows, filtered) and the stock page's announcements list. Calendars and
  // news do not carry it.
  announcementSummarised: ({ stockCodes }) => [
    `${DISCLOSURES_CACHE_PREFIX}announcements:`,
    `${DISCLOSURES_CACHE_PREFIX}dealings:`,
    ...stockCodes.map(stockAnnouncementsPrefix),
  ],
  stockAnalysisChanged: ({ stockCode, analysis }) => [
    stockAnalysisKey(stockCode, analysis),
  ],
  marketBriefLanded: () => [BRIEF_CACHE_PREFIX],
  prospectusAnalysed: ({ prospectusId }) => [prospectusPrefix(prospectusId)],
};

/** The key prefixes one change invalidates (pure; the table's unit-test surface). */
export function invalidationPrefixesFor(change: ReadModelChange): readonly string[] {
  const rule = INVALIDATES[change.kind] as (c: ReadModelChange) => readonly string[];
  return rule(change);
}
