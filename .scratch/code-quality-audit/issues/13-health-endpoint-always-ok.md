# M-08: /health endpoint always returns OK regardless of dependency state

**Severity:** Major  
**Status:** completed  
**Component:** `apps/backend` (NestJS, health)

## Verified ✅

Code review of `apps/backend/src/health/health.controller.ts` confirms the `/health` endpoint now uses `@nestjs/terminus` with `DatabaseHealthIndicator` (SELECT 1 check) and `RedisHealthIndicator` (PING check). Returns `{ status: 'ok', checks: {...} }` when all dependencies are healthy, or `{ status: 'error', ... }` if any dependency is down. Container health probes will now correctly detect outages.

## Problem

The `/health` endpoint always returns `{ status: 'ok' }` without checking any dependencies:

```typescript
// health.controller.ts
@Get()
getHealth(): { status: 'ok' } {
  return { status: 'ok' };  // ← no dependency checks
}
```

### Consequences

1. **Silent failures:** Container orchestrators (ECS, Kubernetes) using this as a liveness probe will mark the container healthy even when Postgres, Redis, or BullMQ are unreachable.
2. **No automatic restart:** An unhealthy container will not be detected and replaced.
3. **Cascading failures:** When the database connection pool is saturated or Redis is down, users will experience timeouts with no alerting.

ADR-0010 explicitly mentions "Compose healthchecks read it now" and "future ECS/ALB consumes the same endpoint," establishing this as a critical monitoring surface.

## Fix

Use `@nestjs/terminus` to add dependency checks:

```typescript
import { HealthCheck, HealthCheckService, DatabaseHealthIndicator, RedisHealthIndicator } from '@nestjs/terminus';

@Get()
@HealthCheck()
check(
  health: HealthCheckService,
  db: DatabaseHealthIndicator,
  redis: RedisHealthIndicator,
) {
  return health.check([
    () => db.pingCheck('database', { connection: this.dataSource }),
    () => redis.isHealthy('redis'),
  ]);
}
```

Returns detailed status:
```json
{
  "status": "ok",
  "checks": {
    "database": { "status": "up" },
    "redis": { "status": "up" }
  }
}
```

Or returns `{ status: 'error', ... }` if any dependency is down.

## Files Affected

- `apps/backend/src/health/health.controller.ts` (add dependency checks)
- `package.json` (add `@nestjs/terminus` if not already present)

## Testing Opportunity

Add integration tests:
1. `test_health_returns_ok_when_all_deps_healthy()`
2. `test_health_returns_error_when_postgres_down()`
3. `test_health_returns_error_when_redis_down()`

---
