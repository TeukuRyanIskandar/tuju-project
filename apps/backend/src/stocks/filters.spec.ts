/**
 * Filter-parsing tests (spec 04; ticket 02): forgiving parse, never a 400.
 */

import { AnnouncementCategory, CorporateActionType } from '../data/entities/enums';
import { endOfUtcDay, parseEnumList, parseIsoDate } from './filters';

describe('parseIsoDate', () => {
  it('parses a strict ISO day to UTC midnight', () => {
    expect(parseIsoDate('2026-10-01')?.toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
  });

  it.each(['', '  ', '2026-10-1', '26-10-01', '2026/10/01', '2026-13-01', undefined])(
    'ignores an unparseable value (%s)',
    (raw) => {
      expect(parseIsoDate(raw as string | undefined)).toBeNull();
    },
  );

  it('rejects calendar-invalid days instead of rolling over', () => {
    expect(parseIsoDate('2026-02-31')).toBeNull();
    expect(parseIsoDate('2026-02-29')).toBeNull(); // 2026 is not a leap year
    expect(parseIsoDate('2024-02-29')).not.toBeNull();
  });
});

it('endOfUtcDay is the last instant of the day', () => {
  expect(endOfUtcDay(new Date('2026-10-01T00:00:00.000Z')).toISOString()).toBe(
    '2026-10-01T23:59:59.999Z',
  );
});

describe('parseEnumList', () => {
  const categories = Object.values(AnnouncementCategory);

  it('parses one-or-more comma-separated values, order preserved', () => {
    expect(
      parseEnumList(
        `${AnnouncementCategory.Entitlement},${AnnouncementCategory.FinancialResults}`,
        categories,
      ),
    ).toEqual([
      AnnouncementCategory.Entitlement,
      AnnouncementCategory.FinancialResults,
    ]);
  });

  it('drops unknown tokens and collapses duplicates (never a 400)', () => {
    expect(
      parseEnumList(
        `NOT_A_CATEGORY,${AnnouncementCategory.Meeting},${AnnouncementCategory.Meeting}`,
        categories,
      ),
    ).toEqual([AnnouncementCategory.Meeting]);
  });

  it('absent / all-invalid → empty list (no filter)', () => {
    expect(parseEnumList(undefined, categories)).toEqual([]);
    expect(parseEnumList('nope', categories)).toEqual([]);
    expect(parseEnumList(',,', categories)).toEqual([]);
  });

  it('works for the corporate-action type enum too', () => {
    expect(
      parseEnumList(`${CorporateActionType.Dividend},${CorporateActionType.Bonus}`, Object.values(CorporateActionType)),
    ).toEqual([CorporateActionType.Dividend, CorporateActionType.Bonus]);
  });
});
