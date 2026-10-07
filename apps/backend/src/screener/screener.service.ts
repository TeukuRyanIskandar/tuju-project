/**
 * Anonymous screener service (spec 03; ticket 02).
 *
 * Owns the endpoint behaviours AROUND the ticket-01 {@link ScreenerQuery}
 * seam: raw-param resolution (the `params.ts` helpers — clamp/drop, never a
 * 400) and the ADR-0004 class-2 read-through cache under `cache:screener:`,
 * keyed by the CANONICAL normalised filter+sort+page params so equivalent
 * requests (defaults spelled out, garbage dropped, lists rotated, clamped
 * pagination) share one entry. The nightly ingest + purge already sweep the
 * prefix (ticket 01's invalidation hooks), so none live here. The join and
 * filter SQL live behind the seam (screener-query.pg.ts).
 */

import { Inject, Injectable } from '@nestjs/common';
import type { ScreenerResponse } from '@tuju/contracts';
import { ReadCacheService, SCREENER_CACHE_PREFIX } from '../cache';
import { parseScreenerQuery, SCREENER_BOARDS, type RawScreenerParams } from './params';
import {
  SCREENER_FILTER_FIELDS,
  SCREENER_FIELDS_CACHE_KEY,
  type ScreenerFieldsResponse,
} from './fields';
import {
  SCREENER_QUERY,
  type ScreenerQuery,
  type ScreenerQueryParams,
  type ScreenerSortKey,
  type SortDirection,
} from './screener-query.interface';

// The wire shape lives in `@tuju/contracts` (ADR-0014).
export type { ScreenerResponse };

/** `true`/`false`; `null` (no constraint) → `` — one unambiguous fragment. */
const boolKeyFragment = (value: boolean | null): string =>
  value === null ? '' : String(value);

/** One resolved number → its string form; `null` (no constraint) → ``. */
const numKeyFragment = (value: number | null): string =>
  value === null ? '' : String(value);

/** Order-insensitive list fragment: sorted, comma-joined; empty → ``. */
const listKeyFragment = (values: readonly string[]): string =>
  [...values].sort().join(',');

/**
 * Canonical cache key for one RESOLVED screen — the class-2 "deterministic
 * over the nightly snapshot" key (spec 03): every filter field in a fixed
 * order, then sort/dir/offset/limit, always emitted at their resolved
 * values. Because the params are already resolved (parsed, defaulted,
 * clamped by `parseScreenerQuery`), equivalent requests normalise to the
 * identical key: an explicit default ≡ the omitted param, `limit=500` ≡
 * `limit=100` (both clamp to 100), a rotated `board=`/`sector=` list ≡ the
 * sorted original, dropped garbage ≡ absent. Same posture as the
 * disclosures service's `key()` — a deterministic per-service string, no
 * shared helper.
 */
export function screenerCacheKey(params: ScreenerQueryParams): string {
  const f = params.filters;
  return `${SCREENER_CACHE_PREFIX}${[
    'screen',
    listKeyFragment(f.boards),
    listKeyFragment(f.sectorIds),
    boolKeyFragment(f.shariah),
    numKeyFragment(f.priceMin),
    numKeyFragment(f.priceMax),
    numKeyFragment(f.volumeMin),
    numKeyFragment(f.marketCapMin),
    numKeyFragment(f.marketCapMax),
    numKeyFragment(f.peMin),
    numKeyFragment(f.peMax),
    numKeyFragment(f.dyMin),
    numKeyFragment(f.dyMax),
    numKeyFragment(f.pNtaMin),
    numKeyFragment(f.pNtaMax),
    numKeyFragment(f.roeMin),
    numKeyFragment(f.roeMax),
    numKeyFragment(f.deMin),
    numKeyFragment(f.deMax),
    numKeyFragment(f.profitableYearsMin),
    numKeyFragment(f.yoyProfitGrowthMin),
    numKeyFragment(f.consecutiveGrowthQuartersMin),
    numKeyFragment(f.rsi14Min),
    numKeyFragment(f.rsi14Max),
    boolKeyFragment(f.aboveSma50),
    boolKeyFragment(f.aboveSma200),
    params.sort,
    params.dir,
    String(params.offset),
    String(params.limit),
  ].join(':')}`;
}

@Injectable()
export class ScreenerService {
  constructor(
    @Inject(SCREENER_QUERY)
    private readonly screenerQuery: ScreenerQuery,
    private readonly readCache: ReadCacheService,
  ) {}

  /**
   * Resolve the raw params (clamp/drop — an odd query string is never a
   * 400), serve the screen read-through the class-2 cache under the
   * canonical key, and echo the resolved values.
   */
  async screen(raw: RawScreenerParams): Promise<ScreenerResponse> {
    const params = parseScreenerQuery(raw);
    const page = await this.readCache.remember(screenerCacheKey(params), () =>
      this.screenerQuery.screen(params),
    );
    return { ...page, sort: params.sort, dir: params.dir };
  }

  /**
   * Serve the fields advertisement (ticket 03): the static vocabulary +
   * board domain from the parse layer's allowlist, the sector domain read
   * through the seam — all under ONE class-2 entry, the `…:fields` key
   * ticket 02 reserved. The nightly ingest + purge sweep the prefix
   * wholesale (a sector that lands mid-horizon appears after the sweep,
   * never half-cached).
   */
  async fields(): Promise<ScreenerFieldsResponse> {
    return this.readCache.remember(SCREENER_FIELDS_CACHE_KEY, async () => ({
      filters: [...SCREENER_FILTER_FIELDS],
      boards: [...SCREENER_BOARDS],
      sectors: await this.screenerQuery.sectors(),
    }));
  }
}
