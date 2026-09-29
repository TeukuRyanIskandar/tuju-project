import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JobName } from '@tuju/contracts';
import { TierGuard } from './tier.guard';
import { REQUIRES_JOB_KEY } from './requires-job.decorator';
import type { AuthedUser } from './session.types';

/**
 * TierGuard allow/deny unit test (ADR-0011: unit layer mocks dependencies — NO
 * live Redis/Postgres). The "session" is a fake `req.user`; the `@RequiresJob`
 * metadata is faked via a stub Reflector. This proves the central capability
 * seam (ADR-0005): a `pro` user may run TA, a `free` user may not.
 */
describe('TierGuard', () => {
  function makeContext(user: AuthedUser | undefined): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  function makeGuard(requiredJob: JobName | undefined): TierGuard {
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === REQUIRES_JOB_KEY ? requiredJob : undefined,
    } as unknown as Reflector;
    return new TierGuard(reflector);
  }

  it('ALLOWS a pro user to run a job their tier permits', () => {
    const guard = makeGuard('analyze-technical');
    const ctx = makeContext({ userId: 'u1', tier: 'pro' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('DENIES a free user a paid job (ForbiddenException)', () => {
    const guard = makeGuard('analyze-technical');
    const ctx = makeContext({ userId: 'u2', tier: 'free' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('DENIES an anonymous request (no req.user) a job-gated route', () => {
    const guard = makeGuard('analyze-fundamental');
    const ctx = makeContext(undefined);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('ALLOWS a route with no @RequiresJob (not job-gated) through', () => {
    const guard = makeGuard(undefined);
    const ctx = makeContext(undefined);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('ALLOWS a premium user to run TA/FA', () => {
    const guard = makeGuard('analyze-fundamental');
    const ctx = makeContext({ userId: 'u3', tier: 'premium' });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
