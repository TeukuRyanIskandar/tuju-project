import type { JobEnvelope, JobFailure, JobName, JobResult } from '@tuju/contracts';

/**
 * Job family seam (architecture-deepening ticket 01).
 *
 * A **job family** is everything the backend knows about one kind of AI job:
 * its identity (how the BullMQ id and the worker's result id are minted and
 * parsed) and its landing (what a result or a final failure writes). One
 * family per `JobName`, except TA and FA, which share one parameterised
 * stock-analysis family.
 *
 * Identity and landing are split on purpose:
 *
 * - **Identity** is pure and lives in `job-identities.ts`. Every process can
 *   enqueue every job (the ingestion worker enqueues the brief, announcement
 *   and prospectus jobs without importing their feature modules), so the
 *   `JobBus` needs the identity of every job without any DI.
 * - **Landing** needs repositories, so a feature module provides it and
 *   registers it with `JobBus.register()` in `onModuleInit`. A process lands
 *   only the families it registers (the API process lands all of them; the
 *   ingestion worker lands stock analysis only, as before).
 */

/** The parsed form of a result id or envelope: which job, and its domain key. */
export interface JobRef<N extends JobName = JobName, K = unknown> {
  jobName: N;
  key: K;
}

/**
 * How one family names its jobs. Two separate ids (spec decision):
 *
 * - `bullId`: the BullMQ custom id, hyphen-joined. BullMQ 5 rejects any custom
 *   id containing `:` (unless it has exactly three parts) and any integer
 *   string, so every family prefixes a word and joins with `-`.
 * - `resultId`: the worker's `JobResult.jobId`, colon-joined with the
 *   registry's `resultIdPrefix` (`@tuju/contracts` `JOBS`). This is the
 *   contract golden the Python worker mints; it is never sent to BullMQ.
 *
 * Both derive from the same domain key, so `parseResultId(resultId(n, k))`
 * round-trips to `{ jobName: n, key: k }`.
 */
export interface JobIdentity<N extends JobName = JobName, K = unknown> {
  readonly jobNames: readonly N[];
  /** The domain key an envelope addresses (stock + bucket, brief date, …). */
  key(jobName: N, env: JobEnvelope<unknown>): K;
  bullId(jobName: N, key: K): string;
  resultId(jobName: N, key: K): string;
  /** Inverse of `resultId`; `null` when the id is not this family's. */
  parseResultId(resultId: string): JobRef<N, K> | null;
}

/**
 * A family's landing. `JobBus` calls exactly one family per result or final
 * failure, chosen by the result id (results) or the BullMQ job name (failures).
 * Both may throw: the `JobBus` logs the error with the job's ids, so a family
 * only logs what it alone knows (e.g. "no instrument for this stock code").
 *
 * `land` is where a family writes its read model. It is also the one place
 * that knows the read model just changed, so cache invalidation belongs here.
 */
export interface JobFamily<N extends JobName = JobName, K = unknown> {
  readonly identity: JobIdentity<N, K>;
  land(result: JobResult, ref: JobRef<N, K>): Promise<void>;
  fail(failure: JobFailure, ref: JobRef<N, K>): Promise<void>;
}

export interface EnqueueOptions {
  /**
   * Replace a retained completed/failed job holding the same BullMQ id
   * (completed jobs are kept 1h, failed 24h) instead of collapsing onto it.
   * Ops re-runs (`--force`, a named prospectus id) set this; the content-
   * derived collapse of the nightly brief and announcement jobs does not.
   */
  replaceFinished?: boolean;
}

/**
 * - `enqueued`: a new job was added.
 * - `inFlight`: a job with the same id is waiting/active/delayed; nothing added.
 * - `finished`: a retained completed/failed job holds the id and
 *   `replaceFinished` was not set; nothing added (the BullMQ dedup collapse).
 */
export type EnqueueStatus = 'enqueued' | 'inFlight' | 'finished';

export interface EnqueueOutcome {
  /** The BullMQ job id (hyphen form). */
  jobId: string;
  status: EnqueueStatus;
}
