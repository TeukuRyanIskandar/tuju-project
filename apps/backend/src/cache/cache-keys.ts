/**
 * Class-2 read-model cache key prefixes (spec 02 ticket 01; ADR-0004).
 * INTERNAL to the cache module: readers name a read via `ReadModelReads`,
 * writers announce a `ReadModelChange`, and nothing outside `src/cache/`
 * builds or sweeps a key (tests may import these to inspect Redis).
 *
 * Everything under `cache:` is a cold-rebuildable read-through copy of
 * Postgres-derived data — losing it is never data loss. Which prefixes a
 * change clears is decided in one table (`read-model-changes.ts`).
 *
 * The strings are byte-identical to the pre-ReadModelCache keys, so a deploy
 * neither orphans nor mis-hits anything already in Redis.
 */

/** Root prefix separating the read cache from BullMQ, sessions and `intraday:` (class 3). */
export const READ_CACHE_KEY_PREFIX = 'cache:';

/** `/search` results. */
export const SEARCH_CACHE_PREFIX = `${READ_CACHE_KEY_PREFIX}search:`;

/** `/stocks/:code` pages + lists. */
export const STOCKS_CACHE_PREFIX = `${READ_CACHE_KEY_PREFIX}stocks:`;

/** Spec-04 disclosure reads (announcements feed, dealings view, calendars, news). */
export const DISCLOSURES_CACHE_PREFIX = `${READ_CACHE_KEY_PREFIX}disclosures:`;

/** Spec-03 screener screens + the fields advertisement. */
export const SCREENER_CACHE_PREFIX = `${READ_CACHE_KEY_PREFIX}screener:`;

/** Spec-05 market-overview reads (EOD movers fallback, index panels, series). */
export const MARKET_CACHE_PREFIX = `${READ_CACHE_KEY_PREFIX}market:`;

/** Spec-06 daily market-brief read (`GET /market-brief/latest`). */
export const BRIEF_CACHE_PREFIX = `${READ_CACHE_KEY_PREFIX}brief:`;

/** Spec-06 prospectus at-a-glance reads (+ proxied artifact). */
export const PROSPECTUS_CACHE_PREFIX = `${READ_CACHE_KEY_PREFIX}prospectus:`;
