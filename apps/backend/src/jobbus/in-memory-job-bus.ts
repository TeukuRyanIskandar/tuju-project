import type {
  JobEnvelope,
  JobFailure,
  JobName,
  JobResult,
} from '@tuju/contracts';
import { JobBus } from './job-bus.service';
import type { EnqueueOptions, EnqueueOutcome } from './job-family';
import { bullIdFor } from './job-identities';

export type InMemoryJobState = 'waiting' | 'active' | 'completed' | 'failed';

export interface InMemoryJob {
  id: string;
  name: JobName;
  data: JobEnvelope<unknown>;
  state: InMemoryJobState;
}

/**
 * The second `JobBus` adapter: an in-process queue for unit tests. Same id
 * derivation (`bullIdFor`), same in-flight/replace semantics and the same
 * family routing as `BullMqJobBus`; no Redis. Tests drive it with
 * `setState`, `complete` and `failJob`.
 */
export class InMemoryJobBus extends JobBus {
  private readonly jobs = new Map<string, InMemoryJob>();
  /** Every job actually added, in order (replacements included). */
  readonly added: InMemoryJob[] = [];

  async enqueue<P>(
    jobName: JobName,
    env: JobEnvelope<P>,
    opts: EnqueueOptions = {},
  ): Promise<EnqueueOutcome> {
    const jobId = bullIdFor(jobName, env);
    const existing = this.jobs.get(jobId);
    if (existing) {
      const finished = existing.state === 'completed' || existing.state === 'failed';
      if (!finished) return { jobId, status: 'inFlight' };
      if (!opts.replaceFinished) return { jobId, status: 'finished' };
    }
    const job: InMemoryJob = { id: jobId, name: jobName, data: env, state: 'waiting' };
    this.jobs.set(jobId, job);
    this.added.push(job);
    return { jobId, status: 'enqueued' };
  }

  job(jobId: string): InMemoryJob | undefined {
    return this.jobs.get(jobId);
  }

  /** Move an enqueued job to a state (e.g. `active`, or `completed` to model retention). */
  setState(jobId: string, state: InMemoryJobState): void {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`InMemoryJobBus: no job ${jobId}`);
    job.state = state;
  }

  /** As BullMQ's 'completed' event: route a worker result to its family. */
  complete(result: JobResult): Promise<void> {
    return this.deliverResult(result);
  }

  /** As BullMQ's final 'failed' event for an enqueued job. */
  failJob(
    jobId: string,
    overrides: Partial<Pick<JobFailure, 'failureClass' | 'retryable' | 'userMessage'>> = {},
  ): Promise<void> {
    const job = this.jobs.get(jobId);
    if (job) job.state = 'failed';
    const failure: JobFailure = {
      correlationId: job?.data.correlationId ?? '',
      jobId,
      failureClass: 'transient_exhausted',
      retryable: true,
      userMessage: 'Job failed.',
      at: new Date().toISOString(),
      ...overrides,
    };
    return this.deliverFailure(failure, job && { name: job.name, data: job.data });
  }
}
