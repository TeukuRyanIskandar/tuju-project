import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { JobName } from '@tuju/contracts';
import { REQUIRES_JOB_KEY } from './requires-job.decorator';
import type { AuthedUser } from './session.types';
import { can } from './tier-policy';

/**
 * The route-level authorization guard (ADR-0005). Reads `@RequiresJob(jobName)`
 * via `Reflector` and asks the capability question `can(user, jobName)` — never a
 * tier name. This is one of the two defense-in-depth checks; the other is the
 * service-level check inside `JobBus.enqueue` (ADR-0005 mechanism).
 *
 * A route without `@RequiresJob` is not job-gated and passes through.
 */
@Injectable()
export class TierGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredJob = this.reflector.getAllAndOverride<JobName | undefined>(
      REQUIRES_JOB_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @RequiresJob → not a paid/job-gated route → allow.
    if (!requiredJob) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthedUser }>();

    if (!can(req.user, requiredJob)) {
      throw new ForbiddenException(
        `Your tier is not permitted to run '${requiredJob}'.`,
      );
    }
    return true;
  }
}
