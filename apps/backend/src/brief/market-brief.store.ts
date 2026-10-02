import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { JobResult } from '@tuju/contracts';
import { JobBus } from '../jobbus/job-bus.service';
import { ReadCacheService, BRIEF_CACHE_PREFIX } from '../cache';
import { MarketBrief } from '../data/entities/market-brief.entity';

/**
 * The Python worker's own `JobResult.jobId` prefix (colon-joined) — mirrors
 * `MARKET_BRIEF_JOB_ID_PREFIX` in `services/ai/src/tuju_ai/config.py` by hand
 * (no shared cross-language constant for this; keep both in lock-step).
 */
const JOB_ID_PREFIX = 'brief:';

/** The one cached key this feature ever reads/writes (`GET /market-brief/latest`). */
export const BRIEF_LATEST_CACHE_KEY = `${BRIEF_CACHE_PREFIX}latest`;

/**
 * Persists the daily market brief's `JobResult` into Postgres (spec 06,
 * ticket 02; ADR-0004 §2/§4) — the `generate-market-brief` sibling of
 * `AnalysisResultStore`.
 *
 * Every NestJS process that imports `JobBusModule` gets its own `QueueEvents`
 * listener on the shared `analysis` queue (Redis-backed), so this store
 * persists results regardless of whether the enqueue came from the nightly
 * worker-process schedule or elsewhere — it only needs to run where the HTTP
 * read endpoint lives (the API process).
 */
@Injectable()
export class MarketBriefStore implements OnModuleInit {
  private readonly logger = new Logger(MarketBriefStore.name);

  constructor(
    private readonly jobBus: JobBus,
    private readonly readCache: ReadCacheService,
    @InjectRepository(MarketBrief)
    private readonly repo: Repository<MarketBrief>,
  ) {}

  onModuleInit(): void {
    this.jobBus.onResult((result: JobResult) => {
      void this.persist(result);
    });
  }

  private async persist(result: JobResult): Promise<void> {
    if (!result.jobId.startsWith(JOB_ID_PREFIX)) return; // not a market-brief result
    const briefDate = result.jobId.slice(JOB_ID_PREFIX.length);

    try {
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
      // Class-2 cache (ADR-0004): invalidate the one cached key directly —
      // this store is the only writer and knows the instant data changed, so
      // it doesn't wait on the nightly-ingest sweep (see cache-keys.ts).
      await this.readCache.del(BRIEF_LATEST_CACHE_KEY);
      this.logger.log({
        msg: 'market brief persisted',
        correlationId: result.correlationId,
        jobId: result.jobId,
        briefDate,
      });
    } catch (err) {
      this.logger.error({
        msg: 'failed to persist market brief',
        correlationId: result.correlationId,
        jobId: result.jobId,
        error: (err as Error).message,
      });
    }
  }

  async findLatest(): Promise<MarketBrief | null> {
    const [latest] = await this.repo.find({
      order: { briefDate: 'DESC' },
      take: 1,
    });
    return latest ?? null;
  }
}
