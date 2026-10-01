/**
 * Screener param-parsing unit tests (spec 03; ticket 01).
 *
 * Pins the house posture for every parse helper: CLAMP/DROP, never a 400 —
 * absent/garbage params resolve to "no constraint" / the spec default, and
 * the resolved pagination matches spec 03 (default 50, hard max 100, offset
 * floored at 0). Pure functions; no containers.
 */

import { ListingBoard } from '../data/entities/enums';
import {
  DEFAULT_SCREENER_DIR,
  DEFAULT_SCREENER_SORT,
  parseBooleanFilter,
  parseNumericFilter,
  parseScreenerDir,
  parseScreenerFilters,
  parseScreenerQuery,
  parseScreenerSort,
  parseSectorIds,
  type RawScreenerParams,
} from './params';

describe('parseNumericFilter', () => {
  it('parses a plain number', () => {
    expect(parseNumericFilter('12.5')).toBe(12.5);
    expect(parseNumericFilter('-0.05')).toBe(-0.05);
    expect(parseNumericFilter('1e3')).toBe(1000);
  });

  it('absent / garbage / non-finite → null (no constraint)', () => {
    expect(parseNumericFilter(undefined)).toBeNull();
    expect(parseNumericFilter('')).toBeNull(); // Number('') is 0 — must not leak
    expect(parseNumericFilter('abc')).toBeNull();
    expect(parseNumericFilter('Infinity')).toBeNull();
    expect(parseNumericFilter('NaN')).toBeNull();
  });
});

describe('parseBooleanFilter', () => {
  it('parses true/false case-insensitively with whitespace', () => {
    expect(parseBooleanFilter('true')).toBe(true);
    expect(parseBooleanFilter('TRUE')).toBe(true);
    expect(parseBooleanFilter(' false ')).toBe(false);
  });

  it('absent / unknown → null (matches neither value)', () => {
    expect(parseBooleanFilter(undefined)).toBeNull();
    expect(parseBooleanFilter('yes')).toBeNull();
    expect(parseBooleanFilter('0')).toBeNull();
    expect(parseBooleanFilter('')).toBeNull();
  });
});

describe('parseScreenerSort / parseScreenerDir', () => {
  it('absent / unknown sort → the spec default (%change)', () => {
    expect(parseScreenerSort(undefined)).toBe(DEFAULT_SCREENER_SORT);
    expect(parseScreenerSort('pctChange')).toBe('pctChange');
    expect(parseScreenerSort('marketCap')).toBe('marketCap');
    expect(parseScreenerSort('rsi14')).toBe(DEFAULT_SCREENER_SORT); // filter, not a returned column
    expect(parseScreenerSort('droptable')).toBe(DEFAULT_SCREENER_SORT);
  });

  it('dir parses asc/desc case-insensitively; anything else → desc default', () => {
    expect(parseScreenerDir(undefined)).toBe(DEFAULT_SCREENER_DIR);
    expect(parseScreenerDir('asc')).toBe('asc');
    expect(parseScreenerDir(' ASC ')).toBe('asc');
    expect(parseScreenerDir('desc')).toBe('desc');
    expect(parseScreenerDir('up')).toBe('desc');
  });
});

describe('parseSectorIds', () => {
  it('parses a comma-separated UUID list, deduped, order-insensitive input', () => {
    const a = '00000000-0000-0000-0000-000000000001';
    const b = '00000000-0000-0000-0000-000000000002';
    expect(parseSectorIds(`${a},${b}`)).toEqual([a, b]);
    expect(parseSectorIds(`${b},${a},${b}`)).toEqual([b, a]);
  });

  it('drops malformed ids (never a Postgres cast error); absent → []', () => {
    const a = '00000000-0000-0000-0000-000000000001';
    expect(parseSectorIds(undefined)).toEqual([]);
    expect(parseSectorIds('not-a-uuid')).toEqual([]);
    expect(parseSectorIds(`${a},junk,12345`)).toEqual([a]);
  });
});

describe('parseScreenerFilters', () => {
  it('board filter rides parseEnumList — LEAP is dropped for free', () => {
    expect(
      parseScreenerFilters({ board: 'MAIN,ACE' }).boards,
    ).toEqual([ListingBoard.Main, ListingBoard.Ace]);
    expect(parseScreenerFilters({ board: 'LEAP' }).boards).toEqual([]);
    expect(parseScreenerFilters({ board: 'MAIN,junk,MAIN' }).boards).toEqual([
      ListingBoard.Main,
    ]);
  });

  it('absent params impose no constraint (all null / empty)', () => {
    const filters = parseScreenerFilters({});
    expect(filters.boards).toEqual([]);
    expect(filters.sectorIds).toEqual([]);
    expect(filters.shariah).toBeNull();
    expect(filters.priceMin).toBeNull();
    expect(filters.marketCapMax).toBeNull();
    expect(filters.peMin).toBeNull();
    expect(filters.dyMax).toBeNull();
    expect(filters.rsi14Min).toBeNull();
    expect(filters.aboveSma50).toBeNull();
    expect(filters.aboveSma200).toBeNull();
    expect(filters.profitableYearsMin).toBeNull();
    expect(filters.yoyProfitGrowthMin).toBeNull();
    expect(filters.consecutiveGrowthQuartersMin).toBeNull();
  });

  it('parses every numeric band member', () => {
    const raw: RawScreenerParams = {
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
    };
    const filters = parseScreenerFilters(raw);
    expect(filters.priceMin).toBe(1);
    expect(filters.priceMax).toBe(2);
    expect(filters.volumeMin).toBe(3);
    expect(filters.marketCapMin).toBe(4);
    expect(filters.marketCapMax).toBe(5);
    expect(filters.peMin).toBe(6);
    expect(filters.peMax).toBe(7);
    expect(filters.dyMin).toBe(0.01);
    expect(filters.dyMax).toBe(0.02);
    expect(filters.pNtaMin).toBe(8);
    expect(filters.pNtaMax).toBe(9);
    expect(filters.roeMin).toBe(0.1);
    expect(filters.roeMax).toBe(0.2);
    expect(filters.deMin).toBe(10);
    expect(filters.deMax).toBe(11);
    expect(filters.profitableYearsMin).toBe(3);
    expect(filters.yoyProfitGrowthMin).toBe(0.05);
    expect(filters.consecutiveGrowthQuartersMin).toBe(4);
    expect(filters.rsi14Min).toBe(30);
    expect(filters.rsi14Max).toBe(70);
  });

  it('garbage values are dropped, never a 400', () => {
    const filters = parseScreenerFilters({
      peMin: 'cheap',
      shariah: 'compliant',
      aboveSma50: '1',
      rsi14Max: 'overbought',
    });
    expect(filters.peMin).toBeNull();
    expect(filters.shariah).toBeNull();
    expect(filters.aboveSma50).toBeNull();
    expect(filters.rsi14Max).toBeNull();
  });
});

describe('parseScreenerQuery', () => {
  it('resolves the full query: defaults + clamped pagination (spec 03)', () => {
    expect(parseScreenerQuery({})).toEqual({
      filters: expect.objectContaining({ boards: [], sectorIds: [] }),
      sort: 'pctChange',
      dir: 'desc',
      offset: 0,
      limit: 50,
    });
  });

  it('clamps pagination like the stock-page lists (default 50, max 100)', () => {
    expect(parseScreenerQuery({ limit: '500', offset: '-3' })).toMatchObject({
      offset: 0,
      limit: 100,
    });
    expect(parseScreenerQuery({ limit: 'abc' })).toMatchObject({ limit: 50 });
    expect(parseScreenerQuery({ offset: '25', limit: '10' })).toMatchObject({
      offset: 25,
      limit: 10,
    });
  });
});
