# m-09: Single Redis for sessions, BullMQ, and cache — no eviction policy documented

**Severity:** Minor  
**Status:** ready-for-human  
**Component:** `apps/backend` (infrastructure, configuration)

## Problem

Sessions (`session:*`), BullMQ queues (`bull:analysis:*`), and read-cache keys (`cache:*`) all coexist on a single Redis instance with no documented eviction policy:

```yaml
# docker-compose.yml (no Redis config found)
services:
  redis:
    image: redis:latest
    # No maxmemory, maxmemory-policy, or appendonly config
```

### Consequences

1. **Silent session eviction:** If Redis fills up under `allkeys-lru` eviction, session keys can be evicted, silently logging out all users.
2. **Queue stalls:** If `noeviction` policy is set, BullMQ job inserts will fail when Redis is full.
3. **Cache unpredictability:** Read-cache keys may be evicted while important job data is retained (or vice versa).
4. **No observability:** There's no documented way to monitor Redis memory usage or predict when eviction might occur.

## Design Context

ADR-0010 acknowledges "Observability is deferred for PoC; health checks read `/health` now." But Redis configuration is genuinely unspecified — not even a temporary `.env` or `docker-compose.override.yml` with a memory limit.

## Fix

**For development:**
```yaml
# docker-compose.yml
services:
  redis:
    image: redis:latest
    command: redis-server --maxmemory 512mb --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
```

**For production:**
1. Use a managed Redis service (AWS ElastiCache, Redis Cloud) with memory monitoring
2. Split the instance into separate namespaces for sessions (persistent) vs cache (evictable):
   - Session keys: use `PERSIST` flag, no eviction
   - Cache keys: use TTL, allow eviction under `allkeys-lru`
   - Job keys: use moderate TTL, separate from cache

3. Document the policy:
   ```
   # Ops guide: Redis configuration
   
   - maxmemory: 1GB (or 10% of system RAM)
   - maxmemory-policy: allkeys-lru (evict LRU keys across all namespaces)
   
   Key namespaces:
   - session:* → user sessions (TTL: 24h)
   - bull:analysis:* → job queue (TTL: 24h for failed jobs)
   - cache:* → read-through cache (TTL: 1h default)
   
   Monitoring:
   - redis-cli INFO memory → check used_memory vs maxmemory
   - Alert when used_memory > 80% of maxmemory
   ```

## Files Affected

- `docker-compose.yml` (add Redis config)
- Create: `docs/ops/redis-configuration.md` (document policy for Ops team)
- `apps/backend/src/redis/redis.module.ts` (document namespaces in comments)
- `.env.example` (document REDIS_* vars if used)

## Related

- ADR-0010 (observability deferred, but this is config, not observability)
- Issue m-10 (Redis configuration for development)

---
