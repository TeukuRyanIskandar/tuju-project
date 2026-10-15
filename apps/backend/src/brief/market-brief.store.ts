import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { JobFailure, JobResult } from '@tuju/contracts';
import { JobBus } from '../jobbus/job-bus.service';
import type { JobFamily, JobRef } from '../jobbus/job-family';
import { marketBriefIdentity } from '../jobbus/job-identities';
import { ReadModelCache } from '../cache';
import { MarketBrief } from '../data/entities/market-brief.entity';

/**
 * The `generate-market-brief` job family: lands the daily brief's `JobResult`
 * into Postgres (spec 06, ticket 02; ADR-0004 §2/§4). The brief date is the
 * family's key, recovered from the worker's result id (`brief:{date}`).
 *
 * Every NestJS process that imports `JobBusModule` gets its own `QueueEvents`
 * listener on the shared `analysis` queue (Redis-backed), so this store
 * persists results regardless of whether the enqueue came from the nightly
 * worker-process schedule or elsewhere — it only needs to run where the HTTP
 * read endpoint lives (the API process).
 */
@Injectable()
export class MarketBriefStore
  implements JobFamily<'generate-market-brief', string>, OnModuleInit
{
  readonly identity = marketBriefIdentity;
  private readonly logger = new Logger(MarketBriefStore.name);

  constructor(
    private readonly jobBus: JobBus,
    private readonly readCache: ReadModelCache,
    @InjectRepository(MarketBrief)
    private readonly repo: Repository<MarketBrief>,
  ) {}

  onModuleInit(): void {
    this.jobBus.register(this);
  }

  async land(
    result: JobResult,
    { key: briefDate }: JobRef<'generate-market-brief', string>,
  ): Promise<void> {
    const row = this.repo.create({
      correlationId: result.correlationId,
      jobId: result.jobId,
      briefDate,
      headline: result.summary.headline,
      asOf: new Date(result.summary.asOf),
      artifactBucket: result.pointer.bucket,
      artifactKey: result.pointer.key,
    });
    // Upsert on (briefDate) — a same-day re-run updates in place (ADR-0007 §2).
    await this.repo.upsert(row, ['briefDate']);
    // This store is the only writer and knows the instant the read model
    // changed; the cache's change table decides what that makes stale.
    await this.readCache.changed({ kind: 'marketBriefLanded' });
    this.logger.log({
      msg: 'market brief persisted',
      correlationId: result.correlationId,
      jobId: result.jobId,
      briefDate,
    });
  }

  /** No row on failure: yesterday's brief stays the latest; Bull Board has the job. */
  async fail(
    failure: JobFailure,
    { key: briefDate }: JobRef<'generate-market-brief', string>,
  ): Promise<void> {
    this.logger.error({
      msg: 'market brief job failed',
      jobId: failure.jobId,
      briefDate,
      reason: failure.userMessage,
    });
  }

  async findLatest(): Promise<MarketBrief | null> {
    const [latest] = await this.repo.find({
      order: { briefDate: 'DESC' },
      take: 1,
    });
    return latest ?? null;
  }
}
