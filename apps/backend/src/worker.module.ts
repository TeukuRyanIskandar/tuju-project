import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { ObservabilityModule } from './observability/observability.module';
import { RedisModule } from './redis/redis.module';
import { IngestionModule } from './ingestion/ingestion.module';

/**
 * Ingestion worker root module (spec 01 process shape; ticket 04, ADR-0012).
 *
 * The root of the **dedicated second NestJS process** — booted headless via
 * `NestFactory.createApplicationContext` in `worker-main.ts` (no HTTP server). It
 * composes only what the worker needs: config (connection-URL-by-env, ADR-0006),
 * structured logging (ADR-0010), the shared Redis client (intraday layer), and
 * {@link IngestionModule} (which owns the `@nestjs/schedule` crons).
 *
 * DELIBERATELY distinct from the API `AppModule`: the API composes auth + HTTP +
 * JobBus and NO schedule module; the worker composes the schedule crons and NO
 * HTTP/auth. Sharing the same entities/migrations/DB connection keeps ADR-0004's
 * sole-writer rule intact (both processes are the same Postgres writer) without a
 * separate workspace (ADR-0002).
 */
@Module({
  imports: [ConfigModule, ObservabilityModule, RedisModule, IngestionModule],
})
export class WorkerModule {}
