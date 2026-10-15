import { Logger } from '@nestjs/common';
import type {
  JobEnvelope,
  JobFailure,
  JobName,
  JobProgress,
  JobResult,
} from '@tuju/contracts';
import type {
  EnqueueOptions,
  EnqueueOutcome,
  JobFamily,
  JobIdentity,
} from './job-family';
import { JOB_IDENTITIES, resolveResultId } from './job-identities';

/**
 * The `JobBus` seam (ADR-0001 guardrail, signatures pinned in ADR-0007 §8).
 *
 * App code talks to `JobBus`, never to BullMQ directly — this contains a future
 * broker migration (e.g. RabbitMQ) to one adapter. Two adapters sit at this
 * seam: `BullMqJobBus` (production, Redis) and `InMemoryJobBus` (unit tests).
 * Nest injects this abstract class as the token.
 *
 *   enqueue<P>(jobName, env, opts?): Promise<{ jobId, status }>
 *   register(family): void
 *   onProgress(handler): void
 *   onResult(handler) / onFailure(handler): observe only
 *
 * Routing (architecture-deepening ticket 01): each result goes to exactly one
 * registered job family, chosen by its result id (`resolveResultId`); each
 * final failure goes to the family of the BullMQ job's name. Families land
 * writes; `onResult`/`onFailure` remain as the ADR-0007 §8 observer hooks and
 * must not be used to land data.
 */
export abstract class JobBus {
  protected readonly logger = new Logger(this.constructor.name);

  private readonly families = new Map<JobName, JobFamily>();
  private readonly progressHandlers: Array<
    (p: JobProgress & { jobId: string }) => void
  > = [];
  private readonly resultObservers: Array<(r: JobResult) => void> = [];
  private readonly failureObservers: Array<(f: JobFailure) => void> = [];

  /**
   * Enqueue a job (ADR-0007 §8). The BullMQ job id is content-derived by the
   * job's family (ADR-0007 §2), so duplicate requests collapse onto one job:
   * an in-flight job is never duplicated, and a retained finished job is
   * replaced only when `replaceFinished` is set.
   */
  abstract enqueue<P>(
    jobName: JobName,
    env: JobEnvelope<P>,
    opts?: EnqueueOptions,
  ): Promise<EnqueueOutcome>;

  /**
   * Register the landing for one job family. Call from the family's
   * `onModuleInit`. Throws if a job name already has a family (exactly one
   * lander per job) or if the family carries an identity other than the one
   * in `JOB_IDENTITIES`.
   */
  register<N extends JobName, K>(family: JobFamily<N, K>): void {
    for (const jobName of family.identity.jobNames) {
      if (this.families.has(jobName)) {
        throw new Error(`JobBus: ${jobName} already has a job family registered`);
      }
      if ((JOB_IDENTITIES[jobName] as JobIdentity) !== (family.identity as JobIdentity)) {
        throw new Error(`JobBus: ${jobName} family must use JOB_IDENTITIES['${jobName}']`);
      }
      this.families.set(jobName, family as unknown as JobFamily);
    }
  }

  onProgress(handler: (p: JobProgress & { jobId: string }) => void): void {
    this.progressHandlers.push(handler);
  }

  onResult(handler: (r: JobResult) => void): void {
    this.resultObservers.push(handler);
  }

  onFailure(handler: (f: JobFailure) => void): void {
    this.failureObservers.push(handler);
  }

  protected emitProgress(progress: JobProgress & { jobId: string }): void {
    for (const handler of this.progressHandlers) handler(progress);
  }

  /** Route a worker result to the one family that owns its result id. */
  protected async deliverResult(result: JobResult): Promise<void> {
    if (typeof result?.jobId !== 'string') {
      this.logger.warn({ msg: 'completed job returned no JobResult; dropped' });
      return;
    }
    for (const observer of this.resultObservers) observer(result);

    const ref = resolveResultId(result.jobId);
    if (!ref) {
      this.logger.warn({
        msg: 'result id belongs to no job family; dropped',
        correlationId: result.correlationId,
        jobId: result.jobId,
      });
      return;
    }
    const family = this.families.get(ref.jobName);
    if (!family) return; // this process does not land this job (e.g. the ingestion worker)

    try {
      await family.land(result, ref);
    } catch (err) {
      this.logger.error({
        msg: 'job family failed to land result',
        jobName: ref.jobName,
        correlationId: result.correlationId,
        jobId: result.jobId,
        error: (err as Error).message,
      });
    }
  }

  /**
   * Route a final failure to the family of the failed BullMQ job. The job's
   * name and envelope (not the id string) pick the family and key, so no
   * BullMQ id is ever parsed. `job` is undefined when BullMQ has already
   * dropped it; the failure is then only logged.
   */
  protected async deliverFailure(
    failure: JobFailure,
    job: { name: string; data: JobEnvelope<unknown> } | undefined,
  ): Promise<void> {
    for (const observer of this.failureObservers) observer(failure);

    const identity = job ? JOB_IDENTITIES[job.name as JobName] : undefined;
    if (!job || !identity) {
      this.logger.warn({
        msg: 'failed job not routable to a job family',
        jobId: failure.jobId,
        jobName: job?.name,
        reason: failure.userMessage,
      });
      return;
    }
    const jobName = job.name as JobName;
    const family = this.families.get(jobName);
    if (!family) return;

    try {
      await family.fail(failure, {
        jobName,
        key: (identity as JobIdentity).key(jobName, job.data),
      });
    } catch (err) {
      this.logger.error({
        msg: 'job family failed to record failure',
        jobName,
        jobId: failure.jobId,
        error: (err as Error).message,
      });
    }
  }
}
