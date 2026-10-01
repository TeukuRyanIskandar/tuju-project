/**
 * Calendar-window tests (spec 04 §3; ticket 02): the default window is next
 * 30 days + 7 back, and each caller-supplied bound replaces only its side.
 */

import {
  CALENDAR_AHEAD_DAYS,
  CALENDAR_BACK_DAYS,
  isoDayOffset,
  resolveCalendarWindow,
} from './calendar-window';

const NOW = new Date('2026-10-01T09:30:00.000Z');

it('the default window is 7 days back … +30 days ahead of today', () => {
  expect(resolveCalendarWindow(undefined, undefined, NOW)).toEqual({
    from: '2026-09-24',
    to: '2026-10-31',
  });
  expect(CALENDAR_BACK_DAYS).toBe(7);
  expect(CALENDAR_AHEAD_DAYS).toBe(30);
});

it('a supplied from/to replaces only its side', () => {
  expect(resolveCalendarWindow('2026-01-01', undefined, NOW)).toEqual({
    from: '2026-01-01',
    to: '2026-10-31',
  });
  expect(resolveCalendarWindow(undefined, '2026-12-31', NOW)).toEqual({
    from: '2026-09-24',
    to: '2026-12-31',
  });
  expect(resolveCalendarWindow('2026-01-01', '2026-12-31', NOW)).toEqual({
    from: '2026-01-01',
    to: '2026-12-31',
  });
});

it('an invalid bound falls back to that side\'s default edge (never a 400)', () => {
  expect(resolveCalendarWindow('not-a-date', '2026-13-01', NOW)).toEqual({
    from: '2026-09-24',
    to: '2026-10-31',
  });
});

it('a calendar-invalid day falls back, it does not roll over', () => {
  expect(resolveCalendarWindow('2026-02-30', undefined, NOW).from).toBe(
    '2026-09-24',
  );
});

it('isoDayOffset moves by whole UTC days', () => {
  expect(isoDayOffset(NOW, 0)).toBe('2026-10-01');
  expect(isoDayOffset(NOW, 45)).toBe('2026-11-15');
  expect(isoDayOffset(NOW, -32)).toBe('2026-08-30');
});
