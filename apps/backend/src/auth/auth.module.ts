import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { SessionStore } from './session.store';
import { TierGuard } from './tier.guard';
import { AuthGuard } from './auth.guard';

/**
 * Auth module (ADR-0005): opaque Redis session behind an httpOnly/Secure/SameSite
 * cookie, plus the capability-shaped TierGuard. Guards are exported so the app can
 * register AuthGuard + TierGuard globally (job-enqueue seam coverage).
 */
@Module({
  controllers: [AuthController],
  providers: [SessionStore, AuthGuard, TierGuard],
  exports: [SessionStore, AuthGuard, TierGuard],
})
export class AuthModule {}
