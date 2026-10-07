import { Controller, Get, NotFoundException } from '@nestjs/common';
import type { MarketBriefResponse } from '@tuju/contracts';
import { ReadCacheService } from '../cache';
import { BRIEF_LATEST_CACHE_KEY, MarketBriefStore } from './market-brief.store';

/**
 * Daily market brief read surface (spec 06, ticket 02).
 *
 *   GET /market-brief/latest → the latest brief's headline + asOf + a way to
 *   reach the fuller artifact (the claim-check pointer). Class-2 read-through
 *   cache (ADR-0004); `MarketBriefStore` invalidates the one cached key the
 *   instant a fresh brief lands, so this never serves a stale "latest".
 *
 * Deliberately carries NO `@RequiresJob`: this is free/anonymous-visible
 * content (ticket 02), not a paid feature — same anonymous posture as the
 * other spec-02/04/05 read surfaces.
 */
@Controller('market-brief')
export class MarketBriefController {
  constructor(
    private readonly store: MarketBriefStore,
    private readonly readCache: ReadCacheService,
  ) {}

  @Get('latest')
  async latest(): Promise<MarketBriefResponse> {
    return this.readCache.remember(BRIEF_LATEST_CACHE_KEY, async () => {
      const brief = await this.store.findLatest();
      if (!brief) {
        // Never cached: `remember` only caches a loader's resolved value, and
        // a thrown exception propagates straight through (read-cache.service.ts).
        throw new NotFoundException('No market brief has been generated yet');
      }
      return {
        briefDate: brief.briefDate,
        headline: brief.headline,
        asOf: brief.asOf.toISOString(),
        artifact: { bucket: brief.artifactBucket, key: brief.artifactKey },
      };
    });
  }
}
