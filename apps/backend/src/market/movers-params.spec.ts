/**
 * Unit tests for movers param parsing (spec 05, ticket 04).
 *
 * Verifies the house clamp/drop posture: an unknown type drops to 'gainers',
 * out-of-range limits clamp, and the rawMoversParams picker extracts only the
 * relevant keys from an unknown query object.
 */

import {
  DEFAULT_MOVERS_LIMIT,
  DEFAULT_MOVERS_TYPE,
  MAX_MOVERS_LIMIT,
  rawMoversParams,
  resolveMoversParams,
} from './movers-params';

describe('resolveMoversParams', () => {
  describe('type resolution', () => {
    it('defaults to "gainers" when type is absent', () => {
      expect(resolveMoversParams({}).type).toBe(DEFAULT_MOVERS_TYPE);
    });

    it('passes through valid type "gainers"', () => {
      expect(resolveMoversParams({ type: 'gainers' }).type).toBe('gainers');
    });

    it('passes through valid type "losers"', () => {
      expect(resolveMoversParams({ type: 'losers' }).type).toBe('losers');
    });

    it('passes through valid type "actives"', () => {
      expect(resolveMoversParams({ type: 'actives' }).type).toBe('actives');
    });

    it('drops unknown type to default "gainers"', () => {
      expect(resolveMoversParams({ type: 'unknown' }).type).toBe('gainers');
    });

    it('drops empty string type to default "gainers"', () => {
      expect(resolveMoversParams({ type: '' }).type).toBe('gainers');
    });

    it('drops "GAINERS" (uppercase) to default — type is case-sensitive', () => {
      expect(resolveMoversParams({ type: 'GAINERS' }).type).toBe('gainers');
    });
  });

  describe('limit resolution', () => {
    it(`defaults to ${DEFAULT_MOVERS_LIMIT} when limit is absent`, () => {
      expect(resolveMoversParams({}).limit).toBe(DEFAULT_MOVERS_LIMIT);
    });

    it('parses a valid integer limit', () => {
      expect(resolveMoversParams({ limit: '20' }).limit).toBe(20);
    });

    it(`clamps to ${MAX_MOVERS_LIMIT} when limit exceeds the max`, () => {
      expect(resolveMoversParams({ limit: '100' }).limit).toBe(MAX_MOVERS_LIMIT);
      expect(resolveMoversParams({ limit: '999' }).limit).toBe(MAX_MOVERS_LIMIT);
    });

    it('drops 0 to the default (not a positive integer)', () => {
      expect(resolveMoversParams({ limit: '0' }).limit).toBe(DEFAULT_MOVERS_LIMIT);
    });

    it('drops negative values to the default', () => {
      expect(resolveMoversParams({ limit: '-5' }).limit).toBe(DEFAULT_MOVERS_LIMIT);
    });

    it('drops non-numeric limit to default', () => {
      expect(resolveMoversParams({ limit: 'abc' }).limit).toBe(DEFAULT_MOVERS_LIMIT);
    });

    it('drops empty string limit to default', () => {
      expect(resolveMoversParams({ limit: '' }).limit).toBe(DEFAULT_MOVERS_LIMIT);
    });

    it('floors a decimal limit (e.g. 15.9 → 15)', () => {
      expect(resolveMoversParams({ limit: '15.9' }).limit).toBe(15);
    });
  });

  describe('combined resolution', () => {
    it('resolves both type and limit together', () => {
      const result = resolveMoversParams({ type: 'actives', limit: '25' });
      expect(result.type).toBe('actives');
      expect(result.limit).toBe(25);
    });
  });
});

describe('rawMoversParams', () => {
  it('extracts type and limit from a query object', () => {
    const q = { type: 'losers', limit: '5', other: 'ignored' };
    expect(rawMoversParams(q)).toEqual({ type: 'losers', limit: '5' });
  });

  it('returns empty object for a non-object input', () => {
    expect(rawMoversParams(null)).toEqual({});
    expect(rawMoversParams(undefined)).toEqual({});
    expect(rawMoversParams('foo')).toEqual({});
  });

  it('omits absent keys rather than including undefined', () => {
    const result = rawMoversParams({ limit: '10' });
    expect(result.type).toBeUndefined();
    expect(result.limit).toBe('10');
  });

  it('ignores non-string type values', () => {
    const result = rawMoversParams({ type: 42 });
    expect(result.type).toBeUndefined();
  });
});
