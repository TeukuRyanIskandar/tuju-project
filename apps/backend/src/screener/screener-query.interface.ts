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

import type {
  Page,
  ScreenerProvenance,
  ScreenerRow,
  ScreenerSectorOption,
  ScreenerSortKey,
  SortDirection,
} from '@tuju/contracts';
import type { ListingBoard } from '../data/entities/enums';

// Wire shapes live in `@tuju/contracts` (ADR-0014); re-exported so screener
// code keeps importing them from the seam.
export type {
  ScreenerProvenance,
  ScreenerRow,
  ScreenerSectorOption,
  ScreenerSortKey,
  SortDirection,
};

/** DI token for the {@link ScreenerQuery} implementation binding. */
export const SCREENER_QUERY = 'SCREENER_QUERY';

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

/** One result page: the matched window plus the total match count. */
export type ScreenerPage = Page<ScreenerRow>;

/**
 * The repository seam: one screen of the analysed universe, plus the sector
 * enum domain the fields endpoint advertises.
 */
export interface ScreenerQuery {
  /**
   * Screen the analysed universe (ordinary shares of MAIN/ACE companies) with
   * the resolved filter set, returning the requested page plus the total
   * match count.
   */
  screen(params: ScreenerQueryParams): Promise<ScreenerPage>;

  /**
   * The sector enum domain (id + name from the `Sector` reference table),
   * name-ordered — the fields endpoint's `sector` filter advertisement.
   */
  sectors(): Promise<ScreenerSectorOption[]>;
}
