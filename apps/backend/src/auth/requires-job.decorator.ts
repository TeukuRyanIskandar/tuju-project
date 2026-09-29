import { SetMetadata } from '@nestjs/common';
import type { JobName } from '@tuju/contracts';

/**
 * `@RequiresJob(jobName)` (ADR-0005) — declares that a route enqueues a given job
 * type and must be gated by the TierGuard. Read via `Reflector` in TierGuard.
 * This is the idiomatic NestJS RBAC shape; the guard asks the capability question
 * `can(user, jobName)`, never a tier name.
 */
export const REQUIRES_JOB_KEY = 'requires_job';

export const RequiresJob = (jobName: JobName) =>
  SetMetadata(REQUIRES_JOB_KEY, jobName);
