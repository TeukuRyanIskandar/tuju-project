/**
 * The instrument search repository seam (spec 02 "Search matching"; ticket 02).
 *
 * The swappable boundary the spec names: the endpoint and service talk to
 * THIS interface, never to Postgres/pg_trgm directly. The spec's decision is
 * no external search engine (YAGNI at Bursa scale) — but the seam exists so
 * one *could* live behind it later with no consumer change.
 *
 * Contract: `query` arrives already normalised (trim + collapsed internal
 * whitespace, never empty — the service guarantees both), `limit` is already
 * clamped (1..100). Implementations return the FIRST rank band with hits,
 * ordered by that band's within-band rule, capped at `limit` — identity
 * fields only, no prices/fundamentals (those live on the stock page).
 */

import type { SearchResultRow } from '@tuju/contracts';

// The wire shape lives in `@tuju/contracts` (ADR-0014).
export type { SearchResultRow };

/** DI token for the {@link InstrumentSearch} implementation binding. */
export const INSTRUMENT_SEARCH = 'INSTRUMENT_SEARCH';

/** The repository seam: rank-band search over the analysed universe. */
export interface InstrumentSearch {
  /**
   * Search the analysed universe (ordinary shares of MAIN/ACE companies) for
   * a normalised, non-empty query, returning at most `limit` rows from the
   * first rank band with hits.
   */
  search(query: string, limit: number): Promise<SearchResultRow[]>;
}
