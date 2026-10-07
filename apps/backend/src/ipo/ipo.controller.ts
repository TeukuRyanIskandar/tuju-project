import { Controller, Get, Param } from '@nestjs/common';
import { ReadCacheService } from '../cache';
import { IpoService } from './ipo.service';
import type {
  IpoReferenceResponse,
  ProspectusAtAGlanceResponse,
} from './ipo.mapping';
import {
  prospectusArtifactCacheKey,
  prospectusAtAGlanceCacheKey,
} from './prospectus-analysis.store';

/**
 * IPO prospectus read surfaces (spec 06, ticket 05). All anonymous — NO
 * `@RequiresJob` (free-tier showcase content, same posture as the brief).
 *
 *   GET /ipo/:prospectusId/reference            worker-facing IPO reference row
 *   GET /ipo/:prospectusId/at-a-glance          headline + asOf + pointer, joined to the listing
 *   GET /ipo/:prospectusId/at-a-glance/artifact proxied rich five-section artifact (ADR-0004 §4)
 *
 * `reference` is uncached (tiny, and the worker needs the live Shariah row).
 * The two at-a-glance reads are class-2 read-through under
 * `PROSPECTUS_CACHE_PREFIX`, invalidated by `ProspectusAnalysisStore` on
 * persist. 404s are never cached (`remember` only caches a resolved value).
 */
@Controller('ipo')
export class IpoController {
  constructor(
    private readonly ipo: IpoService,
    private readonly readCache: ReadCacheService,
  ) {}

  @Get(':prospectusId/reference')
  reference(
    @Param('prospectusId') prospectusId: string,
  ): Promise<IpoReferenceResponse> {
    return this.ipo.getReference(prospectusId);
  }

  @Get(':prospectusId/at-a-glance')
  atAGlance(
    @Param('prospectusId') prospectusId: string,
  ): Promise<ProspectusAtAGlanceResponse> {
    return this.readCache.remember(prospectusAtAGlanceCacheKey(prospectusId), () =>
      this.ipo.getAtAGlance(prospectusId),
    );
  }

  @Get(':prospectusId/at-a-glance/artifact')
  artifact(@Param('prospectusId') prospectusId: string): Promise<unknown> {
    return this.readCache.remember(prospectusArtifactCacheKey(prospectusId), () =>
      this.ipo.getArtifact(prospectusId),
    );
  }
}
