import { Controller, Get, Inject } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorResult,
  HealthIndicatorStatus,
} from '@nestjs/terminus';
import { DataSource } from 'typeorm';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

/**
 * Liveness / health endpoint (ADR-0010 §4). Compose healthchecks read it now; a
 * future ECS/ALB (ADR-0006 scale ladder) consumes the same endpoint. Deliberately
 * a plain liveness probe — deep dependency checks are a later addition.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  @HealthCheck()
  async check() {
    return await this.health.check([
      async (): Promise<HealthIndicatorResult> => ({
        database: {
          status: (await this.db.query('SELECT 1')) ? 'up' : 'down',
        } as { status: HealthIndicatorStatus },
      }),
      async (): Promise<HealthIndicatorResult> => {
        try {
          await this.redis.ping();
          return {
            redis: {
              status: 'up',
            } as { status: HealthIndicatorStatus },
          };
        } catch {
          return {
            redis: {
              status: 'down',
            } as { status: HealthIndicatorStatus },
          };
        }
      },
    ]);
  }
}
