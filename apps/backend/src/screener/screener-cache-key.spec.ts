/**
 * Canonical screener cache-key unit tests (spec 03; ticket 02).
 *
 * Pins the normalisation contract the class-2 cache relies on: equivalent
 * requests (defaults spelled out, garbage dropped, lists rotated, pagination
 * clamped) normalise to ONE key, so they share one cache entry; different
 * filters/sorts/pages normalise to different keys. The last case pins the
 * fixed field order itself, so a future field reorder cannot silently
 * collide entries. Pure functions; no containers.
 */

import { SCREENER_CACHE_PREFIX } from '../cache';
import { parseScreenerQuery, type RawScreenerParams } from './params';
import { screenerCacheKey } from './screener.service';

/** Raw params → the canonical key (resolve first, exactly like the service). */
const keyOf = (raw: RawScreenerParams): string =>
  screenerCacheKey(parseScreenerQuery(raw));

describe('screenerCacheKey', () => {
  it('lands under the invalidation unit the ingest/purge sweep clears', () => {
    expect(keyOf({}).startsWith(`${SCREENER_CACHE_PREFIX}screen:`)).toBe(true);
  });

  it('explicit defaults ≡ omitted params (dropped defaults share one entry)', () => {
    expect(keyOf({})).toBe(
      keyOf({ sort: 'pctChange', dir: 'desc', offset: '0', limit: '50' }),
    );
  });

  it('garbage params drop to no-constraint and share the default key', () => {
    expect(
      keyOf({ peMin: 'cheap', shariah: 'yes', board: 'LEAP', limit: 'abc' }),
    ).toBe(keyOf({}));
  });

  it('clamped pagination equivalents share one entry (resolved values keyed)', () => {
    expect(keyOf({ limit: '500' })).toBe(keyOf({ limit: '100' }));
    expect(keyOf({ offset: '-3' })).toBe(keyOf({ offset: '0' }));
    // But a clamped value is NOT the omitted default: 100 ≠ 50 → distinct.
    expect(keyOf({ limit: '500' })).not.toBe(keyOf({}));
  });

  it('rotated/deduped board + sector lists share one entry (order-insensitive)', () => {
    expect(keyOf({ board: 'MAIN,ACE' })).toBe(keyOf({ board: 'ACE,MAIN' }));
    expect(keyOf({ board: 'MAIN,ACE,MAIN' })).toBe(keyOf({ board: 'ACE,MAIN' }));
    const a = '00000000-0000-0000-0000-0000000000aa';
    const b = '00000000-0000-0000-0000-0000000000bb';
    expect(keyOf({ sector: `${a},${b}` })).toBe(keyOf({ sector: `${b},${a}` }));
  });

  it('different filters/sorts/pages normalise to different keys', () => {
    expect(keyOf({ shariah: 'true' })).not.toBe(keyOf({ shariah: 'false' }));
    expect(keyOf({ shariah: 'true' })).not.toBe(keyOf({}));
    expect(keyOf({ peMin: '0' })).not.toBe(keyOf({ peMin: '10' }));
    // Field order is fixed: a min on one field ≠ a max on another.
    expect(keyOf({ peMin: '10' })).not.toBe(keyOf({ peMax: '10' }));
    expect(keyOf({ aboveSma50: 'true' })).not.toBe(
      keyOf({ aboveSma200: 'true' }),
    );
    expect(keyOf({ sort: 'pe', dir: 'asc' })).not.toBe(
      keyOf({ sort: 'pe', dir: 'desc' }),
    );
    expect(keyOf({ offset: '0' })).not.toBe(keyOf({ offset: '25' }));
  });

  it('pins the fixed field order with a fully-populated screen', () => {
    const a = '00000000-0000-0000-0000-0000000000aa';
    const b = '00000000-0000-0000-0000-0000000000bb';
    const key = keyOf({
      board: 'MAIN,ACE', // key fragment is sorted → ACE,MAIN
      sector: `${b},${a}`, // key fragment is sorted → a,b
      shariah: 'true',
      priceMin: '1',
      priceMax: '2',
      volumeMin: '3',
      marketCapMin: '4',
      marketCapMax: '5',
      peMin: '6',
      peMax: '7',
      dyMin: '0.01',
      dyMax: '0.02',
      pNtaMin: '8',
      pNtaMax: '9',
      roeMin: '0.1',
      roeMax: '0.2',
      deMin: '10',
      deMax: '11',
      profitableYearsMin: '3',
      yoyProfitGrowthMin: '0.05',
      consecutiveGrowthQuartersMin: '4',
      rsi14Min: '30',
      rsi14Max: '70',
      aboveSma50: 'true',
      aboveSma200: 'false',
      sort: 'pe',
      dir: 'asc',
      offset: '25',
      limit: '10',
    });
    expect(key).toBe(
      'cache:screener:screen:' +
        'ACE,MAIN:' +
        `${a},${b}:` +
        'true:' +
        '1:2:3:' +
        '4:5:' +
        '6:7:' +
        '0.01:0.02:' +
        '8:9:' +
        '0.1:0.2:' +
        '10:11:' +
        '3:0.05:4:' +
        '30:70:' +
        'true:false:' +
        'pe:asc:25:10',
    );
  });
});
