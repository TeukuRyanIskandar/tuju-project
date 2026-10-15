import { Controller, Get, Param } from '@nestjs/common';
import type { ProspectusArtifact } from '@tuju/contracts';
import { ReadModelCache, ReadModelReads } from '../cache';
import { IpoService } from './ipo.service';
import type {
  IpoReferenceResponse,
  ProspectusAtAGlanceResponse,
} from './ipo.mapping';

/**
 * IPO prospectus read surfaces (spec 06, ticket 05). All anonymous — NO
 * `@RequiresJob` (free-tier showcase content, same posture as the brief).
 *
 *   GET /ipo/:prospectusId/reference            worker-facing IPO reference row
 *   GET /ipo/:prospectusId/at-a-glance          headline + asOf + pointer, joined to the listing
 *   GET /ipo/:prospectusId/at-a-glance/artifact proxied rich five-section artifact (ADR-0004 §4)
 *
 * `reference` is uncached (tiny, and the worker needs the live Shariah row).
 * The two at-a-glance reads are class-2 read-through named reads,
 * invalidated by `ProspectusAnalysisStore`'s `prospectusAnalysed` change.
 * 404s are never cached (`read` only caches a resolved value).
 */
@Controller('ipo')
export class IpoController {
  constructor(
    private readonly ipo: IpoService,
    private readonly readCache: ReadModelCache,
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
    return this.readCache.read(ReadModelReads.prospectusAtAGlance(prospectusId), () =>
      this.ipo.getAtAGlance(prospectusId),
    );
  }

  @Get(':prospectusId/at-a-glance/artifact')
  artifact(
    @Param('prospectusId') prospectusId: string,
  ): Promise<ProspectusArtifact> {
    return this.readCache.read(ReadModelReads.prospectusArtifact(prospectusId), () =>
      this.ipo.getArtifact(prospectusId),
    );
  }
}
