/**
 * The screener query repository seam (spec 03; ticket 01).
 *
 * The swappable boundary the spec's `GET /screener` endpoint (ticket 02) will
 * talk to, never to Postgres directly — the same shape as the spec-02
 * `InstrumentSearch` seam. The spec's decision is plain indexed SQL over the
 * ~1,000-row analysed universe (no external screening engine), but the seam
 * exists so one could live behind it later with no consumer change.
 *
 * Contract: params arrive already RESOLVED (parsed, clamped, defaulted by the
 * ticket-01 `params.ts` helpers — absent filters are `null`/`[]`, pagination
 * is clamped 1..100). Implementations return the matched page plus the total
 * match count, ordered by the requested sort with NULLs last and `stockCode`
 * as the deterministic tiebreaker.
 */

import type { ListingBoard, ProvenanceClass } from '../data/entities/enums';

/** DI token for the {@link ScreenerQuery} implementation binding. */
export const SCREENER_QUERY = 'SCREENER_QUERY';

/** Sortable columns — exactly the result row's numeric columns (spec 03). */
export type ScreenerSortKey =
  | 'close'
  | 'pctChange'
  | 'marketCap'
  | 'pe'
  | 'dy'
  | 'pNta'
  | 'roe'
  | 'de';

/** Sort direction; the screener default is `pctChange` + `desc`. */
export type SortDirection = 'asc' | 'desc';

/**
 * One resolved filter set (spec 03's filter set; every filter optional).
 * `null`/`[]` means "no constraint". Values are already validated/clamped.
 */
export interface ScreenerFilters {
  /** Listing boards to include (subset of MAIN/ACE; `[]` = whole universe). */
  boards: readonly ListingBoard[];
  /** Sector FK ids to include (`[]` = all sectors). */
  sectorIds: readonly string[];
  /** `true` = latest ShariahStatus COMPLIANT, `false` = NON_COMPLIANT; `null` = either/none. */
  shariah: boolean | null;
  /** Latest-close band (RM). */
  priceMin: number | null;
  priceMax: number | null;
  /** Latest-bar volume floor. */
  volumeMin: number | null;
  /** Market-cap band (latest close × shares outstanding). */
  marketCapMin: number | null;
  marketCapMax: number | null;
  /** P/E band — SQL NULL (loss-maker) never matches a band. */
  peMin: number | null;
  peMax: number | null;
  /** Dividend-yield band — NULL (no trailing dividends) never matches. */
  dyMin: number | null;
  dyMax: number | null;
  /** P/NTA band. */
  pNtaMin: number | null;
  pNtaMax: number | null;
  /** ROE band. */
  roeMin: number | null;
  roeMax: number | null;
  /** D/E band. */
  deMin: number | null;
  deMax: number | null;
  /** Consecutive trailing full years with positive annual net profit, floor. */
  profitableYearsMin: number | null;
  /** Latest-quarter YoY net-profit growth, floor (from QuarterlyFinancials). */
  yoyProfitGrowthMin: number | null;
  /** Consecutive positive-YoY quarters, floor (materialised on the snapshot). */
  consecutiveGrowthQuartersMin: number | null;
  /** RSI-14 band (from the latest IndicatorSnapshot). */
  rsi14Min: number | null;
  rsi14Max: number | null;
  /**
   * `true` = latest close strictly above SMA-50, `false` = at/below;
   * `null` = no constraint. A NULL close/SMA matches NEITHER value.
   */
  aboveSma50: boolean | null;
  /** SMA-200 variant of {@link aboveSma50}. */
  aboveSma200: boolean | null;
}

/** One fully-resolved screener query (filters + sort + page window). */
export interface ScreenerQueryParams {
  filters: ScreenerFilters;
  sort: ScreenerSortKey;
  dir: SortDirection;
  offset: number;
  limit: number;
}

/**
 * Per-numeric-class provenance for one row (spec 03 "Illustrative labelling"):
 * a read-time `IngestionRun` lineage join on each class's source row — the
 * latest price bar, the fundamentals snapshot, the indicator snapshot.
 * Reference fields (`stockCode`/`shortName`/`sector`) are `real` reference
 * data by contract (the stock-page precedent), so they carry no per-row class.
 * `null` = that class's source row is absent for the instrument.
 */
export interface ScreenerProvenance {
  price: ProvenanceClass | null;
  fundamentals: ProvenanceClass | null;
  technicals: ProvenanceClass | null;
}

/** One screener result row (spec 03's row shape; ratios read, not computed). */
export interface ScreenerRow {
  stockCode: string;
  shortName: string;
  sector: string;
  close: number | null;
  /** (latest close − previous close) ÷ previous close × 100; `null` with < 2 bars. */
  pctChange: number | null;
  marketCap: number | null;
  pe: number | null;
  dy: number | null;
  pNta: number | null;
  roe: number | null;
  de: number | null;
  provenance: ScreenerProvenance;
}

/** One result page: the matched window plus the total match count. */
export interface ScreenerPage {
  items: ScreenerRow[];
  total: number;
  offset: number;
  limit: number;
}

/** The repository seam: one screen of the analysed universe. */
export interface ScreenerQuery {
  /**
   * Screen the analysed universe (ordinary shares of MAIN/ACE companies) with
   * the resolved filter set, returning the requested page plus the total
   * match count.
   */
  screen(params: ScreenerQueryParams): Promise<ScreenerPage>;
}
