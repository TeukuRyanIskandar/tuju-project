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

/** DI token for the {@link InstrumentSearch} implementation binding. */
export const INSTRUMENT_SEARCH = 'INSTRUMENT_SEARCH';

/**
 * One search result row — instrument identity joined to issuer identity.
 * All strings; the numeric columns of the model are never surfaced here.
 */
export interface SearchResultRow {
  /** Stable Bursa 4-digit code (unique natural key). */
  stockCode: string;
  /** Mutable short ticker name (e.g. `MAYBANK`). */
  shortName: string;
  /** Mutable full instrument name. */
  fullName: string;
  /** Issuer registered name (`Company.fullName`). */
  companyName: string;
  /** Listing board (`MAIN`/`ACE` — LEAP is outside the analysed universe). */
  board: string;
  /** Bursa sector name (joined through `Company.sector`). */
  sectorName: string;
}

/** The repository seam: rank-band search over the analysed universe. */
export interface InstrumentSearch {
  /**
   * Search the analysed universe (ordinary shares of MAIN/ACE companies) for
   * a normalised, non-empty query, returning at most `limit` rows from the
   * first rank band with hits.
   */
  search(query: string, limit: number): Promise<SearchResultRow[]>;
}
