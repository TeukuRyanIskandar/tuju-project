import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { JobFailure, JobResult } from '@tuju/contracts';
import { JobBus } from '../jobbus/job-bus.service';
import { ReadCacheService, PROSPECTUS_CACHE_PREFIX } from '../cache';
import { ProspectusAnalysis } from '../data/entities/prospectus-analysis.entity';
import { isUuid } from '../stocks/filters';
import { prospectusIdFromJobId } from './ipo.mapping';

/** BullMQ dedup-id prefix (hyphen form) — see `prospectusBullJobId`. */
const BULL_JOB_ID_PREFIX = 'prospectus-';

/** All cached keys for one prospectus share this prefix (self-invalidation unit). */
export const prospectusCachePrefix = (prospectusId: string): string =>
  `${PROSPECTUS_CACHE_PREFIX}${prospectusId}:`;

export const prospectusAtAGlanceCacheKey = (prospectusId: string): string =>
  `${prospectusCachePrefix(prospectusId)}at-a-glance`;

export const prospectusArtifactCacheKey = (prospectusId: string): string =>
  `${prospectusCachePrefix(prospectusId)}artifact`;

/**
 * Persists the `analyze-prospectus` `JobResult` as a thin Postgres row (spec 06,
 * ticket 05; ADR-0004 §2/§4) — the prospectus sibling of `MarketBriefStore`.
 *
 * The prospectus id is NOT a field of `JobResult`; it is recovered from the
 * worker's own content-derived `jobId` (`prospectus:{IpoListing.id}`), the same
 * prefix-parsing pattern the brief/announcement stores use.
 *
 * Class-2 cache: owns the `cache:prospectus:` prefix, which is deliberately NOT
 * in `READ_CACHE_PREFIXES` (the nightly-ingest sweep); this store invalidates
 * the affected prospectus' keys itself the instant a result lands.
 *
 * Terminal failure: no row is written (a failed listing therefore stays
 * eligible for the next `enqueue-prospectus` run — the not-yet-processed
 * predicate is "no row"); the failure is logged with the jobId so an operator
 * can find it in Bull Board. (`JobBus` failure events carry the BullMQ job id,
 * not a correlationId, so only the hyphen-form id is matched here.)
 */
@Injectable()
export class ProspectusAnalysisStore implements OnModuleInit {
  private readonly logger = new Logger(ProspectusAnalysisStore.name);

  constructor(
    private readonly jobBus: JobBus,
    private readonly readCache: ReadCacheService,
    @InjectRepository(ProspectusAnalysis)
    private readonly repo: Repository<ProspectusAnalysis>,
  ) {}

  onModuleInit(): void {
    this.jobBus.onResult((result: JobResult) => {
      void this.persist(result);
    });
    this.jobBus.onFailure((failure: JobFailure) => {
      if (!failure.jobId.startsWith(BULL_JOB_ID_PREFIX)) return;
      this.logger.error({
        msg: 'prospectus analysis job failed; listing stays eligible for re-enqueue',
        jobId: failure.jobId,
        reason: failure.userMessage,
      });
    });
  }

  async persist(result: JobResult): Promise<void> {
    const prospectusId = prospectusIdFromJobId(result.jobId);
    if (prospectusId === null) return; // not a prospectus result

    if (!isUuid(prospectusId)) {
      this.logger.warn({
        msg: 'prospectus analysis: jobId does not carry an IpoListing uuid',
        correlationId: result.correlationId,
        jobId: result.jobId,
      });
      return;
    }

    try {
      const now = new Date();
      const row = this.repo.create({
        prospectusId,
        correlationId: result.correlationId,
        jobId: result.jobId,
        headline: result.summary.headline,
        asOf: new Date(result.summary.asOf),
        artifactBucket: result.pointer.bucket,
        artifactKey: result.pointer.key,
        updatedAt: now,
      });
      // Upsert on the FK: a re-run of the same curated IPO updates in place.
      await this.repo.upsert(row, ['prospectusId']);
      await this.readCache.invalidatePrefix(prospectusCachePrefix(prospectusId));
      this.logger.log({
        msg: 'prospectus analysis persisted',
        correlationId: result.correlationId,
        jobId: result.jobId,
        prospectusId,
      });
    } catch (err) {
      // Includes the FK violation for an unknown listing id.
      this.logger.error({
        msg: 'failed to persist prospectus analysis',
        correlationId: result.correlationId,
        jobId: result.jobId,
        prospectusId,
        error: (err as Error).message,
      });
    }
  }
}
