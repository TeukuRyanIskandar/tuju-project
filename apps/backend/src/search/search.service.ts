/**
 * Anonymous instrument search service (spec 02 "Search matching"; ticket 02).
 *
 * Owns the endpoint behaviours AROUND the {@link InstrumentSearch} seam: query
 * normalisation (trim + collapse internal whitespace, once, before ranking),
 * limit clamping (default 20, hard max 100 — clamped, never an error), and
 * the ADR-0004 class-2 read-through cache (`cache:search:` prefix, TTL from
 * the service default; the nightly ingest + purge already invalidate the
 * prefix, so no invalidation hooks live here). The rank bands themselves
 * live behind the seam (instrument-search.pg.ts).
 *
 * Empty / whitespace-only queries return an empty result (200, not 400) — an
 * FE search box firing on empty is normal, not an error.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { SearchResponse } from '@tuju/contracts';
import { ReadCacheService, SEARCH_CACHE_PREFIX } from '../cache';
import {
  INSTRUMENT_SEARCH,
  type InstrumentSearch,
  type SearchResultRow,
} from './instrument-search.interface';

/** Default result cap; the endpoint never streams the whole universe. */
export const DEFAULT_SEARCH_LIMIT = 20;

/** Hard cap on ?limit= — clamped, never a 400. */
export const MAX_SEARCH_LIMIT = 100;

// The wire shape lives in `@tuju/contracts` (ADR-0014).
export type { SearchResponse };

/**
 * Normalise once before ranking: trim the ends and collapse internal
 * whitespace runs to single spaces (spec 02). The caller's casing is
 * preserved for the echo; the cache key case-folds below so case variants
 * share one entry (they are one ranking — ILIKE/similarity are
 * case-insensitive below the cache too).
 */
export function normaliseSearchQuery(raw: string | undefined): string {
  return (raw ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * Clamp ?limit=: the default when absent/non-numeric/non-positive, the hard
 * max when oversized. Clamping (never erroring) keeps the anonymous endpoint
 * unbreakable.
 */
export function clampSearchLimit(raw: string | undefined): number {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_SEARCH_LIMIT;
  return Math.min(n, MAX_SEARCH_LIMIT);
}

@Injectable()
export class SearchService {
  constructor(
    @Inject(INSTRUMENT_SEARCH)
    private readonly instrumentSearch: InstrumentSearch,
    private readonly readCache: ReadCacheService,
  ) {}

  async search(
    rawQuery: string | undefined,
    rawLimit?: string | undefined,
  ): Promise<SearchResponse> {
    const query = normaliseSearchQuery(rawQuery);
    if (query === '') return { query, items: [] };

    const limit = clampSearchLimit(rawLimit);
    const cacheKey = `${SEARCH_CACHE_PREFIX}${query.toLowerCase()}:${limit}`;
    const items = await this.readCache.remember(cacheKey, () =>
      this.instrumentSearch.search(query, limit),
    );
    return { query, items };
  }
}
