import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import type { Redis } from 'ioredis';
import { randomUUID } from 'crypto';
import type {
  JobEnvelope,
  JobFailure,
  JobName,
  JobProgress,
  JobResult,
} from '@tuju/contracts';
import { REDIS_CLIENT } from '../redis/redis.module';
import { JobBus } from './job-bus.service';
import type { EnqueueOptions, EnqueueOutcome } from './job-family';
import { bullIdFor } from './job-identities';
import { ANALYSIS_QUEUE } from './job-names';

/** States in which a job holding an id is done; anything else is in flight. */
const FINISHED_STATES = new Set(['completed', 'failed']);

/**
 * The production `JobBus` adapter: BullMQ over the shared Redis (ADR-0001).
 * Retention + retry/backoff (ADR-0007 §6/§7) are configured on enqueue.
 */
@Injectable()
export class BullMqJobBus extends JobBus implements OnModuleInit, OnModuleDestroy {
  private readonly queue: Queue;
  private readonly events: QueueEvents;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    super();
    this.queue = new Queue(ANALYSIS_QUEUE, { connection: this.redis });
    this.events = new QueueEvents(ANALYSIS_QUEUE, { connection: this.redis });
  }

  async onModuleInit(): Promise<void> {
    await this.events.waitUntilReady();

    // BullMQ native progress → QueueEvents 'progress' (ADR-0001/0007 §4).
    this.events.on('progress', ({ jobId, data }) => {
      this.emitProgress({ ...(data as JobProgress), jobId });
    });

    // Result hand-off via job.returnvalue on 'completed' (ADR-0007 §7).
    this.events.on('completed', ({ returnvalue }) => {
      if (!returnvalue) return;
      const result =
        typeof returnvalue === 'string'
          ? (JSON.parse(returnvalue) as JobResult)
          : (returnvalue as unknown as JobResult);
      void this.deliverResult(result);
    });

    // Final failure (retries exhausted or terminal) → UI-facing event (§6).
    this.events.on('failed', async ({ jobId, failedReason }) => {
      const job = await this.queue.getJob(jobId);
      const env = job?.data as JobEnvelope<unknown> | undefined;
      const isTerminal = failedReason?.startsWith('UnrecoverableError') ?? false;
      const failure: JobFailure = {
        correlationId: env?.correlationId ?? randomUUID(),
        jobId: jobId ?? '',
        failureClass: isTerminal ? 'terminal' : 'transient_exhausted',
        retryable: !isTerminal,
        userMessage: failedReason ?? 'Job failed.',
        at: new Date().toISOString(),
      };
      await this.deliverFailure(
        failure,
        job && env ? { name: job.name, data: env } : undefined,
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.events.close();
  }

  async enqueue<P>(
    jobName: JobName,
    env: JobEnvelope<P>,
    opts: EnqueueOptions = {},
  ): Promise<EnqueueOutcome> {
    const jobId = bullIdFor(jobName, env);

    // BullMQ silently ignores an `add` whose id still exists — including a
    // retained COMPLETED (1h) or FAILED (24h) job. Report that instead of
    // pretending to enqueue, and replace a finished one on request.
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state !== 'unknown') {
        if (!FINISHED_STATES.has(state)) return this.collapsed(jobName, jobId, env, 'inFlight');
        if (!opts.replaceFinished) return this.collapsed(jobName, jobId, env, 'finished');
        await existing.remove();
      }
    }

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
    return { jobId, status: 'enqueued' };
  }

  /** Introspection surface for Bull Board only (ADR-0010 §4); not on the seam. */
  getQueue(): Queue {
    return this.queue;
  }

  private collapsed(
    jobName: JobName,
    jobId: string,
    env: JobEnvelope<unknown>,
    status: 'inFlight' | 'finished',
  ): EnqueueOutcome {
    this.logger.log({
      msg: 'job collapsed onto an existing id',
      jobName,
      jobId,
      status,
      correlationId: env.correlationId,
    });
    return { jobId, status };
  }
}
