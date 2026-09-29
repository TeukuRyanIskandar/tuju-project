import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { JobEnvelope, JobProgress, JobResult } from '@tuju/contracts';
import { REDIS_CLIENT } from '../redis/redis.module';
import { ANALYSIS_QUEUE } from './job-names';

/**
 * A SCAFFOLD stub worker (ADR-0001 guardrail: run an early smoke test of the core
 * submit → progress → result loop). It emits one progress step then returns a
 * well-formed `JobResult` (ADR-0007 §5) so the JobBus round-trips end-to-end
 * against a local Redis, proving the seam.
 *
 * The REAL worker is the Python/LangGraph service (services/ai, ticket 05) — this
 * exists only to make the scaffold's round-trip observable and is trivially
 * removable once the Python worker consumes the queue.
 */
@Injectable()
export class StubJobWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StubJobWorker.name);
  private worker?: Worker;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  onModuleInit(): void {
    // Skip the in-process stub worker unless explicitly enabled — in real runs
    // the Python worker (ticket 05) consumes the queue.
    if (process.env.ENABLE_STUB_WORKER !== 'true') return;

    this.worker = new Worker(
      ANALYSIS_QUEUE,
      async (job: Job): Promise<JobResult> => {
        const env = job.data as JobEnvelope<{ symbol: string }>;
        const progress: JobProgress = {
          stepIndex: 0,
          stepTotal: 1,
          phase: 'queued',
          label: 'stub worker processing',
          at: new Date().toISOString(),
        };
        await job.updateProgress(progress);

        const result: JobResult = {
          correlationId: env.correlationId,
          jobId: job.id ?? '',
          pointer: {
            bucket: 'stub',
            key: `results/${job.id}.json`,
            sha256: 'stub',
            bytes: 0,
            contentType: 'application/json',
          },
          summary: {
            verdict: 'neutral',
            headline: `stub analysis for ${env.payload.symbol}`,
            asOf: env.asOf,
          },
          at: new Date().toISOString(),
        };
        this.logger.log({
          msg: 'stub job processed',
          jobId: job.id,
          correlationId: env.correlationId,
        });
        return result;
      },
      { connection: this.redis },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
