/**
 * Query-param filter parsing shared across the read surfaces (originated for
 * disclosures, spec 04 ticket 02; `isUuid` is also used by `market.service.ts`
 * and `disclosures.service.ts` for their `:id` resource lookups).
 *
 * Same posture as `pagination.ts` (spec 02): CLAMP, never 400 — a free-tier
 * browse surface is forgiving of odd query strings and the resolved values
 * are echoed / keyed into the class-2 cache so two equivalent requests (one
 * clamped) share one cache entry. Invalid tokens are dropped, never rejected.
 */

/** Loose UUID check so an obviously-malformed `:id` 404s before any query. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Strict ISO `YYYY-MM-DD` → UTC-midnight Date; anything else → null (ignored). */
export function parseIsoDate(raw: string | undefined): Date | null {
  if (raw === undefined) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
  // Calendar-invalid strings (e.g. 2026-02-31, 2026-13-01) → null, never
  // a rolled-over date (toISOString throws on an invalid Date, so probe first).
  if (Number.isNaN(date.getTime())) return null;
  if (date.toISOString().slice(0, 10) !== `${y}-${m}-${d}`) return null;
  return date;
}

/** End of the ISO day (23:59:59.999 UTC) of a UTC-midnight date. */
export function endOfUtcDay(date: Date): Date {
  return new Date(date.getTime() + 24 * 60 * 60 * 1000 - 1);
}

/**
 * Parse a comma-separated enum filter (`?category=A,B` / `?type=DIVIDEND`).
 * Unknown tokens are dropped (never a 400), duplicates collapse, order is
 * preserved; an all-invalid / absent param → `[]` (no filter).
 */
export function parseEnumList<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
): T[] {
  if (raw === undefined) return [];
  const out: T[] = [];
  for (const token of raw.split(',')) {
    const value = token.trim() as T;
    if (allowed.includes(value) && !out.includes(value)) out.push(value);
  }
  return out;
}
