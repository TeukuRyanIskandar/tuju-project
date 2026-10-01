/**
 * Corporate-actions calendar window (spec 04 §3; ticket 02).
 *
 * The default window is **next 30 days + 7 back** around "today" (UTC date),
 * and a caller-supplied bound replaces only its side: `?from=` alone widens
 * the past edge to a fixed date while the forward edge stays +30 days, and
 * an invalid bound falls back to the default edge (clamp, never 400 — same
 * posture as `stocks/filters.ts`).
 */

/** Days behind "today" in the default calendar window. */
export const CALENDAR_BACK_DAYS = 7;

/** Days ahead of "today" in the default calendar window. */
export const CALENDAR_AHEAD_DAYS = 30;

/** A resolved inclusive window, ISO `YYYY-MM-DD` dates. */
export interface CalendarWindow {
  from: string;
  to: string;
}

/** ISO `YYYY-MM-DD` of `date ± days` (UTC — calendar rows are date-only). */
export function isoDayOffset(date: Date, days: number): string {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Resolve the calendar window: each side defaults to its spec-04 edge
 * (7 back / +30 ahead of `now`), a valid ISO bound replaces it, an invalid
 * bound falls back to the default edge.
 */
export function resolveCalendarWindow(
  rawFrom: string | undefined,
  rawTo: string | undefined,
  now: Date = new Date(),
): CalendarWindow {
  const defaultFrom = isoDayOffset(now, -CALENDAR_BACK_DAYS);
  const defaultTo = isoDayOffset(now, CALENDAR_AHEAD_DAYS);
  const from = parseIsoDay(rawFrom) ?? defaultFrom;
  const to = parseIsoDay(rawTo) ?? defaultTo;
  return { from, to };
}

/** Strict ISO `YYYY-MM-DD`, calendar-valid; anything else → null. */
function parseIsoDay(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const probe = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
  // toISOString throws on an invalid Date (e.g. month 13), so probe first.
  if (Number.isNaN(probe.getTime())) return null;
  if (probe.toISOString().slice(0, 10) !== `${y}-${m}-${d}`) return null;
  return `${y}-${m}-${d}`;
}
