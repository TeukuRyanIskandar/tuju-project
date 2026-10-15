/**
 * Pure-helper unit tests for the stock-page endpoints (spec 02; ticket 03
 * testing seam) — pagination clamping, numeric serialisation, and %change.
 * No Docker: the composition/provenance/cache behaviours are pinned against
 * real testcontainers in `stocks.int.spec.ts`.
 */

import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  resolvePagination,
} from './pagination';
import { pctChange, toNumber } from './serialisation';
import { isStockSeriesQuery } from './series-query';

describe('resolvePagination (clamping, never 400)', () => {
  it('defaults offset 0 and limit 50 when params are absent', () => {
    expect(resolvePagination()).toEqual({ offset: 0, limit: DEFAULT_PAGE_LIMIT });
    expect(resolvePagination(undefined, undefined)).toEqual({
      offset: 0,
      limit: DEFAULT_PAGE_LIMIT,
    });
  });

  it('accepts explicit offset/limit', () => {
    expect(resolvePagination('10', '5')).toEqual({ offset: 10, limit: 5 });
  });

  it('clamps negative offset to 0', () => {
    expect(resolvePagination('-3', '20').offset).toBe(0);
  });

  it('clamps limit above the hard max of 100', () => {
    expect(resolvePagination('0', '101')).toEqual({ offset: 0, limit: MAX_PAGE_LIMIT });
    expect(resolvePagination('0', '500').limit).toBe(MAX_PAGE_LIMIT);
  });

  it('falls back to defaults on unparseable values', () => {
    expect(resolvePagination('abc', 'xyz')).toEqual({
      offset: 0,
      limit: DEFAULT_PAGE_LIMIT,
    });
    expect(resolvePagination('', '').offset).toBe(0);
  });

  it('treats a negative limit as absent (default), not as a clamped value', () => {
    expect(resolvePagination('0', '-1').limit).toBe(DEFAULT_PAGE_LIMIT);
  });

  it('floors decimal params', () => {
    expect(resolvePagination('2.9', '7.9')).toEqual({ offset: 2, limit: 7 });
  });
});

describe('toNumber (TypeORM numeric → JS number, null passthrough)', () => {
  it('converts numeric column strings to JS numbers', () => {
    expect(toNumber('18.300000')).toBe(18.3);
    expect(toNumber('0.056700')).toBe(0.0567);
    expect(toNumber('-0.083400')).toBe(-0.0834);
  });

  it('converts bigint strings (shares outstanding)', () => {
    expect(toNumber('8700000000')).toBe(8_700_000_000);
  });

  it('passes already-number values through', () => {
    expect(toNumber(42)).toBe(42);
  });

  it('passes null and undefined through as null (no recompute, no zero)', () => {
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
  });
});

describe('pctChange ((latest − prev) / prev × 100)', () => {
  it('computes the change between two closes', () => {
    // (10.02 − 9.87) / 9.87 × 100 ≈ 1.5198
    expect(pctChange(10.02, 9.87)).toBeCloseTo(((10.02 - 9.87) / 9.87) * 100, 10);
  });

  it('returns a negative change when the latest close is lower', () => {
    expect(pctChange(9.5, 10)).toBeCloseTo(-5, 10);
  });

  it('returns null on a zero previous close (undefined change, never NaN)', () => {
    expect(pctChange(1, 0)).toBeNull();
    expect(pctChange(0, 0)).toBeNull();
  });
});

describe('isStockSeriesQuery (PoC-fixed interval/range)', () => {
  it('accepts 1d/2y and defaults when absent', () => {
    expect(isStockSeriesQuery('1d', '2y')).toBe(true);
    expect(isStockSeriesQuery(undefined, undefined)).toBe(true);
  });

  it('rejects other interval or range values', () => {
    expect(isStockSeriesQuery('1h', '2y')).toBe(false);
    expect(isStockSeriesQuery('1d', '1y')).toBe(false);
  });
});
