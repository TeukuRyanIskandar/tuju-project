/**
 * Anonymous screener service (spec 03; ticket 02).
 *
 * Owns the endpoint behaviours AROUND the ticket-01 {@link ScreenerQuery}
 * seam: raw-param resolution (the `params.ts` helpers — clamp/drop, never a
 * 400) and the ADR-0004 class-2 read-through cache (`ReadModelReads.screen`),
 * keyed by the CANONICAL resolved filter+sort+page params so equivalent
 * requests (defaults spelled out, garbage dropped, lists rotated, clamped
 * pagination) share one entry. The nightly ingest + purge changes already
 * invalidate it, so no invalidation hooks live here. The join and
 * filter SQL live behind the seam (screener-query.pg.ts).
 */

import { Inject, Injectable } from '@nestjs/common';
import type { ScreenerResponse } from '@tuju/contracts';
import { ReadModelCache, ReadModelReads } from '../cache';
import { parseScreenerQuery, SCREENER_BOARDS, type RawScreenerParams } from './params';
import { SCREENER_FILTER_FIELDS, type ScreenerFieldsResponse } from './fields';
import { SCREENER_QUERY, type ScreenerQuery } from './screener-query.interface';

// The wire shape lives in `@tuju/contracts` (ADR-0014).
export type { ScreenerResponse };

@Injectable()
export class ScreenerService {
  constructor(
    @Inject(SCREENER_QUERY)
    private readonly screenerQuery: ScreenerQuery,
    private readonly readCache: ReadModelCache,
  ) {}

  /**
   * Resolve the raw params (clamp/drop — an odd query string is never a
   * 400), serve the screen read-through the class-2 cache under the
   * canonical key, and echo the resolved values.
   */
  async screen(raw: RawScreenerParams): Promise<ScreenerResponse> {
    const params = parseScreenerQuery(raw);
    const page = await this.readCache.read(ReadModelReads.screen(params), () =>
      this.screenerQuery.screen(params),
    );
    return { ...page, sort: params.sort, dir: params.dir };
  }

  /**
   * Serve the fields advertisement (ticket 03): the static vocabulary +
   * board domain from the parse layer's allowlist, the sector domain read
   * through the seam — all under ONE class-2 entry
   * (`ReadModelReads.screenerFields`). The nightly ingest + purge clear it (a sector that lands mid-horizon appears after the sweep,
   * never half-cached).
   */
  async fields(): Promise<ScreenerFieldsResponse> {
    return this.readCache.read(ReadModelReads.screenerFields(), async () => ({
      filters: [...SCREENER_FILTER_FIELDS],
      boards: [...SCREENER_BOARDS],
      sectors: await this.screenerQuery.sectors(),
    }));
  }
}
