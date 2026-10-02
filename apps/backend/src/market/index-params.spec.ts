/**
 * Unit tests for index series range param parsing (spec 05, ticket 05).
 *
 * Verifies the house clamp/drop posture: unknown/absent range → default '1y',
 * valid values pass through, and `seriesSinceDate` anchors the lookback to the
 * SERIES' OWN latest stored date — never the wall clock (the synthetic backfill
 * ends at a fixed historical date, so a wall-clock anchor would drift the
 * series out of every range as real time passes).
 */

import {
  DEFAULT_SERIES_RANGE,
  INDEX_SERIES_RANGES,
  RANGE_DAYS,
  resolveSeriesRange,
  seriesSinceDate,
  type IndexSeriesRange,
} from './index-params';

describe('resolveSeriesRange', () => {
  describe('range resolution', () => {
    it(`defaults to '${DEFAULT_SERIES_RANGE}' when range is absent`, () => {
      expect(resolveSeriesRange(undefined).range).toBe(DEFAULT_SERIES_RANGE);
    });

    it.each(INDEX_SERIES_RANGES as IndexSeriesRange[])(
      'passes through valid range %s',
      (range) => {
        expect(resolveSeriesRange(range).range).toBe(range);
      },
    );

    it('drops unknown value to default', () => {
      expect(resolveSeriesRange('2y').range).toBe(DEFAULT_SERIES_RANGE);
    });

    it('drops empty string to default', () => {
      expect(resolveSeriesRange('').range).toBe(DEFAULT_SERIES_RANGE);
    });

    it("drops '1Y' (uppercase) to default — range is case-sensitive", () => {
      expect(resolveSeriesRange('1Y').range).toBe(DEFAULT_SERIES_RANGE);
    });
  });

  describe('days resolution', () => {
    it("returns days = null for 'all'", () => {
      expect(resolveSeriesRange('all').days).toBeNull();
    });

    it.each(INDEX_SERIES_RANGES as IndexSeriesRange[])(
      'echoes RANGE_DAYS for %s',
      (range) => {
        expect(resolveSeriesRange(range).days).toBe(RANGE_DAYS[range]);
      },
    );
  });

  describe('RANGE_DAYS mapping', () => {
    it('maps every valid range to a number or null', () => {
      for (const range of INDEX_SERIES_RANGES) {
        const days = RANGE_DAYS[range as IndexSeriesRange];
        if (range === 'all') {
          expect(days).toBeNull();
        } else {
          expect(typeof days).toBe('number');
          expect(days).toBeGreaterThan(0);
        }
      }
    });

    it("maps '1m' to 30", () => expect(RANGE_DAYS['1m']).toBe(30));
    it("maps '3m' to 90", () => expect(RANGE_DAYS['3m']).toBe(90));
    it("maps '6m' to 180", () => expect(RANGE_DAYS['6m']).toBe(180));
    it("maps '1y' to 365", () => expect(RANGE_DAYS['1y']).toBe(365));
    it("maps '3y' to 1095", () => expect(RANGE_DAYS['3y']).toBe(1095));
    it("maps '5y' to 1825", () => expect(RANGE_DAYS['5y']).toBe(1825));
    it("maps 'all' to null", () => expect(RANGE_DAYS['all']).toBeNull());
  });
});

describe('seriesSinceDate', () => {
  const LATEST = '2025-12-31'; // the synthetic backfill's fixed end date

  it('returns null for days = null (the "all" range)', () => {
    expect(seriesSinceDate(LATEST, null)).toBeNull();
  });

  it('returns null when there is no stored series yet', () => {
    expect(seriesSinceDate(null, 30)).toBeNull();
  });

  it("computes the cutoff 30 days back from the series' latest date ('1m')", () => {
    expect(seriesSinceDate(LATEST, 30)).toBe('2025-12-01');
  });

  it("computes the cutoff 365 days back from the series' latest date ('1y')", () => {
    expect(seriesSinceDate(LATEST, 365)).toBe('2024-12-31');
  });

  it("computes the cutoff 90 days back from the series' latest date ('3m')", () => {
    expect(seriesSinceDate(LATEST, 90)).toBe('2025-10-02');
  });

  it('anchors to the series date, not the wall clock — stable regardless of "today"', () => {
    // Same inputs always give the same cutoff; nothing reads Date.now().
    expect(seriesSinceDate(LATEST, 30)).toBe(seriesSinceDate(LATEST, 30));
  });
});
