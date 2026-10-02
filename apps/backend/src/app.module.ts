import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from './config/config.module';
import { ObservabilityModule } from './observability/observability.module';
import { RedisModule } from './redis/redis.module';
import { DataModule } from './data/data.module';
import { JobBusModule } from './jobbus/job-bus.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { TierGuard } from './auth/tier.guard';
import { HealthModule } from './health/health.module';
import { AnalysisModule } from './analysis/analysis.module';
import { SearchModule } from './search/search.module';
import { StocksModule } from './stocks/stocks.module';
import { DisclosuresModule } from './disclosures/disclosures.module';
import { ScreenerModule } from './screener/screener.module';

/**
 * Root module (ADR-0001/0003/0004/0005/0006/0010).
 *
 * AuthGuard + TierGuard are registered GLOBALLY: AuthGuard resolves req.user from
 * the session cookie on every request; TierGuard enforces `can(user, jobName)` on
 * any route carrying `@RequiresJob` — the central authorization seam (ADR-0005).
 */
@Module({
  imports: [
    ConfigModule,
    ObservabilityModule,
    RedisModule,
    DataModule,
    JobBusModule,
    AuthModule,
    HealthModule,
    AnalysisModule,
    // Spec-02 anonymous free-tier read endpoints (search + stock page). No
    // @RequiresJob on any of their routes → TierGuard passes → anonymous.
    SearchModule,
    StocksModule,
    // Spec-04 anonymous free-tier disclosure reads (market feed, dealings,
    // calendars, news) — same anonymous posture as search/stocks.
    DisclosuresModule,
    // Spec-03 anonymous free-tier screener (GET /screener) — same anonymous
    // posture as the other read surfaces.
    ScreenerModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: TierGuard },
  ],
})
export class AppModule {}
