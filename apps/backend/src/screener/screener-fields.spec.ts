/**
 * Screener fields advertisement unit tests (spec 03; ticket 03).
 *
 * Pins the `GET /screener/fields` vocabulary — the descriptors the FE builds
 * its form from — and guards it against DRIFT versus the `GET /screener`
 * parse layer (ticket 01's `params.ts`):
 *
 * 1. The full descriptor list is pinned exactly, so a filter cannot appear
 *    or vanish silently (an FE-contract change must fail this suite first).
 * 2. The advertised params cover EXACTLY the raw filter params the
 *    `GET /screener` endpoint understands (`RAW_SCREENER_PARAM_KEYS` minus
 *    the sort/dir/page keys) — a param added to one surface and not the
 *    other fails here.
 * 3. Every advertised param is LIVE in the parse layer: a probe value fed
 *    through `parseScreenerFilters` flips exactly one resolved filter field
 *    — a renamed param, a dropped parse branch, or a kind change
 *    (numeric/boolean/enum) fails here.
 *
 * Pure — no containers, no DI.
 */

import {
  parseScreenerFilters,
  RAW_SCREENER_PARAM_KEYS,
  RAW_SCREENER_NON_FILTER_KEYS,
  type RawScreenerParams,
} from './params';
import type { ScreenerFilters } from './screener-query.interface';
import { SCREENER_CACHE_PREFIX } from '../cache/cache-keys';
import {
  SCREENER_FILTER_FIELDS,
  SCREENER_FIELDS_CACHE_KEY,
  type ScreenerFilterField,
} from './fields';

/** A syntactically-valid sector id (the domain values are UUIDs). */
const SECTOR_PROBE_UUID = '00000000-0000-0000-0000-000000000001';

/** The exact advertised vocabulary (the wire contract, pinned). */
const PINNED_FIELDS: readonly ScreenerFilterField[] = [
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

/** Every raw HTTP param the advertisement references (duplicates visible). */
function advertisedParams(fields: readonly ScreenerFilterField[]): string[] {
  const params: string[] = [];
  for (const field of fields) {
    if (field.kind === 'numericBand') {
      params.push(field.minParam);
      if (field.maxParam !== null) params.push(field.maxParam);
    } else {
      params.push(field.param);
    }
  }
  return params;
}

/** Probe value for one advertised param, by the descriptor's kind. */
function probeValue(field: ScreenerFilterField, param: string): string {
  if (field.kind === 'boolean') return 'true';
  if (field.kind === 'enum') {
    return param === 'board' ? 'MAIN' : SECTOR_PROBE_UUID;
  }
  // numericBand: a min probe and a max probe, both plainly finite numbers.
  return param === field.minParam ? '5' : '7';
}

describe('SCREENER_FILTER_FIELDS (the GET /screener/fields vocabulary)', () => {
  it('pins the full descriptor list — a filter cannot appear or vanish silently', () => {
    expect(SCREENER_FILTER_FIELDS).toEqual(PINNED_FIELDS);
  });

  it('each descriptor names its own raw params (no shared/param-overlap)', () => {
    const params = advertisedParams(SCREENER_FILTER_FIELDS);
    expect(new Set(params).size).toBe(params.length);
  });

  it('advertises exactly the GET /screener filter params — no drift vs the parse layer', () => {
    const filterParams = RAW_SCREENER_PARAM_KEYS.filter(
      (key) => !RAW_SCREENER_NON_FILTER_KEYS.includes(key),
    ).sort();
    expect([...new Set(advertisedParams(SCREENER_FILTER_FIELDS))].sort()).toEqual(
      filterParams,
    );
  });

  it('every advertised param is live in the parse layer: a probe value flips exactly one resolved filter', () => {
    const baseline = parseScreenerFilters({});
    const filterKeys = Object.keys(baseline) as (keyof ScreenerFilters)[];

    for (const field of SCREENER_FILTER_FIELDS) {
      for (const param of advertisedParams([field])) {
        const parsed = parseScreenerFilters({
          [param]: probeValue(field, param),
        } as RawScreenerParams);
        // Structured compare per resolved filter field (arrays and all).
        const flipped = filterKeys.filter(
          (key) =>
            JSON.stringify(parsed[key]) !== JSON.stringify(baseline[key]),
        );
        expect(flipped).toHaveLength(1);
      }
    }
  });

  it('board probes land on the board domain; sector probes on the sector-id list', () => {
    expect(parseScreenerFilters({ board: 'MAIN' }).boards).toEqual(['MAIN']);
    expect(parseScreenerFilters({ sector: SECTOR_PROBE_UUID }).sectorIds).toEqual([
      SECTOR_PROBE_UUID,
    ]);
  });

  it('the fields cache key rides the swept screener prefix, exactly as ticket 02 reserved it', () => {
    expect(SCREENER_FIELDS_CACHE_KEY).toBe(`${SCREENER_CACHE_PREFIX}fields`);
  });
});
