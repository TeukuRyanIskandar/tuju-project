/**
 * Screener fields advertisement (spec 03; ticket 03) — the `GET /screener/fields`
 * vocabulary, PURE (no DI, no I/O): the descriptors are static, the enum
 * domains ride the response (boards from the parse layer's allowlist, sectors
 * read through the seam at request time).
 *
 * The FE builds its form from THIS list, never a hardcoded copy: each
 * descriptor names the filter, its kind (enum / numeric band / boolean), and
 * the raw `GET /screener` params it reads (`minParam`/`maxParam` for a band —
 * `maxParam: null` marks a floor-only filter like `volume`; `domain` points an
 * enum filter at its value list in the response).
 *
 * Drift is guarded, not assumed: the descriptors' params are typed
 * `keyof RawScreenerParams` (a param the screen endpoint does not understand
 * does not compile), and `screener-fields.spec.ts` pins the exact list plus
 * coverage/probe checks against ticket 01's parse layer.
 */

import { SCREENER_CACHE_PREFIX } from '../cache/cache-keys';
import type { ListingBoard } from '../data/entities/enums';
import type { RawScreenerParams } from './params';
import type { ScreenerSectorOption } from './screener-query.interface';

/**
 * The class-2 cache key for the fields response — the `…:fields` suffix
 * ticket 02 reserved under the `cache:screener:` prefix the nightly ingest
 * + purge already sweep.
 */
export const SCREENER_FIELDS_CACHE_KEY = `${SCREENER_CACHE_PREFIX}fields`;

/** One raw `GET /screener` param name (the parse layer's vocabulary). */
type ScreenerParam = keyof RawScreenerParams & string;

/**
 * One advertised screener filter. A discriminated union on `kind`: an enum
 * filter points at its domain (`boards`/`sectors`) in the response; a
 * boolean filter takes one `true`/`false` param; a numeric band takes a
 * `minParam` and — unless it is floor-only (`maxParam: null`) — a `maxParam`.
 */
export type ScreenerFilterField =
  | {
      /** Conceptual filter name (identity + label), e.g. `pe`. */
      name: string;
      kind: 'enum';
      /** The single raw param this filter reads. */
      param: ScreenerParam;
      /** Which response member carries this filter's value domain. */
      domain: 'boards' | 'sectors';
    }
  | {
      name: string;
      kind: 'boolean';
      param: ScreenerParam;
    }
  | {
      name: string;
      kind: 'numericBand';
      minParam: ScreenerParam;
      /** `null` when the filter is floor-only (e.g. `volume`). */
      maxParam: ScreenerParam | null;
    };

/**
 * The advertised filter vocabulary — spec 03's filter set, grouped as in the
 * spec (universe, price/liquidity, valuation, quality, growth, technical).
 * Pinned exactly by `screener-fields.spec.ts`; a change is an FE-contract
 * change and must fail that suite first.
 */
export const SCREENER_FILTER_FIELDS: readonly ScreenerFilterField[] = [
  { name: 'board', kind: 'enum', param: 'board', domain: 'boards' },
  { name: 'sector', kind: 'enum', param: 'sector', domain: 'sectors' },
  { name: 'shariah', kind: 'boolean', param: 'shariah' },
  { name: 'price', kind: 'numericBand', minParam: 'priceMin', maxParam: 'priceMax' },
  { name: 'volume', kind: 'numericBand', minParam: 'volumeMin', maxParam: null },
  { name: 'marketCap', kind: 'numericBand', minParam: 'marketCapMin', maxParam: 'marketCapMax' },
  { name: 'pe', kind: 'numericBand', minParam: 'peMin', maxParam: 'peMax' },
  { name: 'dy', kind: 'numericBand', minParam: 'dyMin', maxParam: 'dyMax' },
  { name: 'pNta', kind: 'numericBand', minParam: 'pNtaMin', maxParam: 'pNtaMax' },
  { name: 'roe', kind: 'numericBand', minParam: 'roeMin', maxParam: 'roeMax' },
  { name: 'de', kind: 'numericBand', minParam: 'deMin', maxParam: 'deMax' },
  { name: 'profitableYears', kind: 'numericBand', minParam: 'profitableYearsMin', maxParam: null },
  { name: 'yoyProfitGrowth', kind: 'numericBand', minParam: 'yoyProfitGrowthMin', maxParam: null },
  { name: 'consecutiveGrowthQuarters', kind: 'numericBand', minParam: 'consecutiveGrowthQuartersMin', maxParam: null },
  { name: 'rsi14', kind: 'numericBand', minParam: 'rsi14Min', maxParam: 'rsi14Max' },
  { name: 'aboveSma50', kind: 'boolean', param: 'aboveSma50' },
  { name: 'aboveSma200', kind: 'boolean', param: 'aboveSma200' },
];

/** The `GET /screener/fields` response: the vocabulary + the enum domains.
 * The sector option shape lives on the seam (`screener-query.interface.ts`) —
 * its single home, shared with the read that fills it. */
export interface ScreenerFieldsResponse {
  /** The filter descriptors (see {@link ScreenerFilterField}). */
  filters: readonly ScreenerFilterField[];
  /** The `board` domain — MAIN/ACE (the analysed universe; LEAP is dropped). */
  boards: readonly ListingBoard[];
  /** The `sector` domain — id + name, name-ordered. */
  sectors: readonly ScreenerSectorOption[];
}
