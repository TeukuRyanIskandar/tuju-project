import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { JobFailure, JobResult } from '@tuju/contracts';
import { JobBus } from '../jobbus/job-bus.service';
import type { JobFamily, JobRef } from '../jobbus/job-family';
import { prospectusIdentity } from '../jobbus/job-identities';
import { ReadModelCache } from '../cache';
import { ProspectusAnalysis } from '../data/entities/prospectus-analysis.entity';
import { isUuid } from '../stocks/filters';

/**
 * The `analyze-prospectus` job family: lands the `JobResult` as a thin Postgres
 * row (spec 06, ticket 05; ADR-0004 §2/§4) — the prospectus sibling of
 * `MarketBriefStore`.
 *
 * The prospectus id is NOT a field of `JobResult`; it is the family's key,
 * recovered from the worker's result id (`prospectus:{IpoListing.id}`) by
 * `prospectusIdentity`.
 *
 * Class-2 cache: announces `prospectusAnalysed` the instant a result lands
 * (the ingest/purge changes deliberately leave prospectus reads alone).
 *
 * Terminal failure: no row is written (a failed listing therefore stays
 * eligible for the next `enqueue-prospectus` run — the not-yet-processed
 * predicate is "no row"); the failure is logged with the jobId so an operator
 * can find it in Bull Board.
 */
@Injectable()
export class ProspectusAnalysisStore
  implements JobFamily<'analyze-prospectus', string>, OnModuleInit
{
  readonly identity = prospectusIdentity;
  private readonly logger = new Logger(ProspectusAnalysisStore.name);

  constructor(
    private readonly jobBus: JobBus,
    private readonly readCache: ReadModelCache,
    @InjectRepository(ProspectusAnalysis)
    private readonly repo: Repository<ProspectusAnalysis>,
  ) {}

  onModuleInit(): void {
    this.jobBus.register(this);
  }

  async land(
    result: JobResult,
    { key: prospectusId }: JobRef<'analyze-prospectus', string>,
  ): Promise<void> {
    if (!isUuid(prospectusId)) {
      this.logger.warn({
        msg: 'prospectus analysis: jobId does not carry an IpoListing uuid',
        correlationId: result.correlationId,
        jobId: result.jobId,
      });
      return;
    }

    const row = this.repo.create({
      prospectusId,
      correlationId: result.correlationId,
      jobId: result.jobId,
      headline: result.summary.headline,
      asOf: new Date(result.summary.asOf),
      artifactBucket: result.pointer.bucket,
      artifactKey: result.pointer.key,
      updatedAt: new Date(),
    });
    // Upsert on the FK: a re-run of the same curated IPO updates in place.
    // An unknown listing id throws the FK violation (logged by the JobBus).
    await this.repo.upsert(row, ['prospectusId']);
    await this.readCache.changed({ kind: 'prospectusAnalysed', prospectusId });
    this.logger.log({
      msg: 'prospectus analysis persisted',
      correlationId: result.correlationId,
      jobId: result.jobId,
      prospectusId,
    });
  }

  async fail(
    failure: JobFailure,
    { key: prospectusId }: JobRef<'analyze-prospectus', string>,
  ): Promise<void> {
    this.logger.error({
      msg: 'prospectus analysis job failed; listing stays eligible for re-enqueue',
      jobId: failure.jobId,
      prospectusId,
      reason: failure.userMessage,
    });
  }
}
