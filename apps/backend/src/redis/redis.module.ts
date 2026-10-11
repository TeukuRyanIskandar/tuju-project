import { Global, Module, type OnModuleDestroy } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import IORedis, { type Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config';

/** DI token for the shared ioredis connection (ADR-0001/0004/0005: one Redis). */
export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * Redis wiring (ADR-0006: reached by REDIS_URL, never a hardcoded host).
 *
 * A single Redis instance backs BullMQ (ADR-0001), the opaque session store
 * (ADR-0005), and the read-through cache (ADR-0004), separated by key prefix.
 * `maxRetriesPerRequest: null` is required by BullMQ for blocking commands.
 *
 * ## Key namespaces
 *
 * The Redis instance uses three key prefixes, each with distinct semantics:
 *
 * - **`session:*`** — Express session store (ADR-0005).
 *   - TTL: 24 hours (session expiration).
 *   - Semantics: Critical user sessions; eviction should be avoided.
 *   - Under allkeys-lru with 512MB memory, older sessions are evicted when memory fills.
 *
 * - **`bull:*`** — BullMQ queue and job metadata (ADR-0001).
 *   - TTL: Variable (config: completed jobs retained 1h, failed jobs 24h; see ADR-0007 §7).
 *   - Semantics: Job envelopes, progress, results, and intermediate state.
 *   - Queue integrity depends on processing rate vs. memory; see redis-configuration.md.
 *
 * - **`cache:*`** — Read-through cache for expensive queries (ADR-0004).
 *   - TTL: Varies by query class (typically 1 hour for market data snapshots).
 *   - Semantics: Ephemeral cache layer; eviction here has minimal impact.
 *   - Candidates for eviction under allkeys-lru when memory is constrained.
 *
 * ## Memory management
 *
 * Local development (docker-compose.yml) uses `--maxmemory 512mb` with
 * `--maxmemory-policy allkeys-lru` for predictable behavior; see docs/ops/redis-configuration.md
 * for production guidance and monitoring.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Redis =>
        new IORedis(config.redisUrl, { maxRetriesPerRequest: null }),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
