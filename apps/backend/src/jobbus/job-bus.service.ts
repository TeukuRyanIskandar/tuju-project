import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import type { Redis } from 'ioredis';
import type {
  JobEnvelope,
  JobFailure,
  JobName,
  JobProgress,
  JobResult,
} from '@tuju/contracts';
import { REDIS_CLIENT } from '../redis/redis.module';
import { ANALYSIS_QUEUE } from './job-names';

/**
 * The `JobBus` seam (ADR-0001 guardrail, signatures pinned in ADR-0007 §8).
 *
 * App code talks to `JobBus`, never to BullMQ directly — this contains a future
 * broker migration (e.g. RabbitMQ) to this file. The NestJS producer surface:
 *
 *   enqueue<P>(jobName, env): Promise<{ jobId }>
 *   onProgress(handler): void
 *   onResult(handler): void
 *   onFailure(handler): void
 *
 * Retention + retry/backoff (ADR-0007 §6/§7) are configured on enqueue.
 */
@Injectable()
export class JobBus implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobBus.name);
  private readonly queue: Queue;
  private readonly events: QueueEvents;

  private readonly progressHandlers: Array<
    (p: JobProgress & { jobId: string }) => void
  > = [];
  private readonly resultHandlers: Array<(r: JobResult) => void> = [];
  private readonly failureHandlers: Array<(f: JobFailure) => void> = [];

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    this.queue = new Queue(ANALYSIS_QUEUE, { connection: this.redis });
    this.events = new QueueEvents(ANALYSIS_QUEUE, { connection: this.redis });
  }

  async onModuleInit(): Promise<void> {
    await this.events.waitUntilReady();

    // BullMQ native progress → QueueEvents 'progress' (ADR-0001/0007 §4).
    this.events.on('progress', ({ jobId, data }) => {
      const progress = data as JobProgress;
      for (const handler of this.progressHandlers) {
        handler({ ...progress, jobId });
      }
    });

    // Result hand-off via job.returnvalue on 'completed' (ADR-0007 §7).
    this.events.on('completed', ({ returnvalue }) => {
      if (!returnvalue) return;
      const result =
        typeof returnvalue === 'string'
          ? (JSON.parse(returnvalue) as JobResult)
          : (returnvalue as unknown as JobResult);
      for (const handler of this.resultHandlers) handler(result);
    });

    // Final failure (retries exhausted or terminal) → UI-facing event (§6).
    this.events.on('failed', ({ jobId, failedReason }) => {
      const failure: JobFailure = {
        correlationId: '',
        jobId: jobId ?? '',
        failureClass: 'transient_exhausted',
        retryable: true,
        userMessage: failedReason ?? 'Job failed.',
        at: new Date().toISOString(),
      };
      for (const handler of this.failureHandlers) handler(failure);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.events.close();
  }

  /**
   * Enqueue a job (ADR-0007 §8). The BullMQ job id is content-derived for
   * idempotency (ADR-0007 §2) so a user-click and a system price-move for the
   * same analysis in the same window collapse to one job.
   */
  async enqueue<P>(
    jobName: JobName,
    env: JobEnvelope<P>,
  ): Promise<{ jobId: string }> {
    const jobId = this.deriveJobId(jobName, env);
    await this.queue.add(jobName, env, {
      jobId,
      attempts: 3,
      backoff: { type: 'fixed', delay: 5000 },
      removeOnComplete: { age: 60 * 60 }, // 1h (ADR-0007 §7)
      removeOnFail: { age: 60 * 60 * 24 }, // 24h — kept longer for debugging
    });
    this.logger.log({
      msg: 'job enqueued',
      jobName,
      jobId,
      correlationId: env.correlationId,
    });
    return { jobId };
  }

  onProgress(handler: (p: JobProgress & { jobId: string }) => void): void {
    this.progressHandlers.push(handler);
  }

  onResult(handler: (r: JobResult) => void): void {
    this.resultHandlers.push(handler);
  }

  onFailure(handler: (f: JobFailure) => void): void {
    this.failureHandlers.push(handler);
  }

  /** Introspection surface for Bull Board / health (ADR-0010 §4). */
  getQueue(): Queue {
    return this.queue;
  }

  /**
   * Content-derived, idempotent job id (ADR-0007 §2).
   * e.g. `ta:{symbol}:{...}:{asOfBucket}`. The scaffold derives a stable id from
   * the job name + payload + asOf so BullMQ dedupes duplicate concurrent requests.
   */
  private deriveJobId<P>(jobName: JobName, env: JobEnvelope<P>): string {
    const payload = env.payload as Record<string, unknown>;
    const symbol = String(payload.symbol ?? 'unknown');
    const discriminator = String(
      payload.timeframe ?? payload.period ?? 'default',
    );
    const asOfBucket = env.asOf.slice(0, 13); // hour bucket
    const prefix = jobName === 'analyze-technical' ? 'ta' : 'fa';
    return `${prefix}:${symbol}:${discriminator}:${asOfBucket}`;
  }
}
