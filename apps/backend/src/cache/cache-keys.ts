/**
 * Class-2 read-through cache key prefixes (spec 02 ticket 01; ADR-0004).
 *
 * Everything under `cache:` is a cold-rebuildable read-through copy of
 * Postgres-derived data — losing it is never data loss. The prefixes are the
 * invalidation units: the nightly ingest and the decision-B purge clear them
 * wholesale after new data commits, so no consumer ever pins an invalidation
 * key by hand.
 */

/** Root prefix separating the read cache from BullMQ + the session store. */
export const READ_CACHE_KEY_PREFIX = 'cache:';

/** `/search` results — invalidated on roster change / nightly ingest. */
export const SEARCH_CACHE_PREFIX = `${READ_CACHE_KEY_PREFIX}search:`;

/** `/stocks/:code` pages + lists — invalidated on nightly ingest / purge. */
export const STOCKS_CACHE_PREFIX = `${READ_CACHE_KEY_PREFIX}stocks:`;

/**
 * Spec-04 disclosure reads (market announcements feed, dealings view,
 * calendars, news feed) — invalidated on the disclosure/RSS ingest cadence
 * (the demo folds both into the nightly ingest) and on purge.
 */
export const DISCLOSURES_CACHE_PREFIX = `${READ_CACHE_KEY_PREFIX}disclosures:`;

/** Spec-03 screener screens — invalidated on the nightly ingest / purge. */
export const SCREENER_CACHE_PREFIX = `${READ_CACHE_KEY_PREFIX}screener:`;
