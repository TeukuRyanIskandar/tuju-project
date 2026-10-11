# Redis Configuration & Operations Guide

**Status:** Ready for ops team  
**Related:** Issue 23 (redis-no-eviction-policy), ADR-0001, ADR-0004, ADR-0005

---

## Overview

A single Redis instance backs three critical subsystems on the tuju platform:

1. **Sessions** (`session:*`) — user authentication sessions (ADR-0005)
2. **BullMQ** (`bull:*`) — async job queue and metadata (ADR-0001)
3. **Cache** (`cache:*`) — read-through cache layer (ADR-0004)

This document prescribes memory management, eviction policy, and operational procedures to ensure reliability across all three.

---

## Configuration

### Development (docker-compose.yml)

```yaml
redis:
  image: redis:7.4-alpine
  command: 
    - redis-server
    - --appendonly yes          # Durability: AOF persistence (ADR-0006)
    - --maxmemory 512mb         # Memory limit for local dev
    - --maxmemory-policy allkeys-lru  # Evict oldest-used keys when full
  environment:
    TZ: Asia/Kuala_Lumpur       # Timezone consistency across stack
```

### Production Guidance

**Use a managed service:** AWS ElastiCache, Google Cloud Memorystore, or Redis Cloud. Configuration below applies regardless of deployment model.

**Key settings:**

| Setting | Value | Rationale |
|---------|-------|-----------|
| `maxmemory` | 10% of available system RAM, minimum 1 GB | Prevents host OOM kills. For a 16 GB instance, use 1.6 GB. |
| `maxmemory-policy` | `allkeys-lru` | When memory fills, evict oldest-unused keys across all namespaces. Allows sessions, jobs, and cache to compete fairly. |
| `appendonly` | `yes` | AOF persistence for durability (ADR-0006). In production, consider `appendfsync everysec` for balance of durability vs. write throughput. |
| `timeout` | `300` | Close idle client connections after 5 min to prevent resource leaks. |
| `tcp-keepalive` | `300` | Heartbeat to detect stale connections. |

---

## Key Namespaces

### 1. Sessions: `session:*`

- **TTL:** 24 hours (configured in NestJS session middleware)
- **Expected volume:** 1–10 MB (thousands of active users)
- **Eviction impact:** HIGH — if sessions are evicted, all users are logged out silently
- **Behavior under allkeys-lru:** Older sessions are evicted first; recent users stay logged in

**Monitoring:**
```bash
# Count session keys
redis-cli --scan --match 'session:*' | wc -l

# Sample a session key size
redis-cli debug object session:abc123def456
```

### 2. BullMQ: `bull:*`

- **TTL:** Variable
  - Completed jobs: 1 hour (removed after processing)
  - Failed jobs: 24 hours (retained for debugging)
  - Job payloads: Retained until completion or expiry
- **Expected volume:** Depends on job load; in normal operation, <50 MB
- **Eviction impact:** MEDIUM — if jobs are evicted mid-processing, they may be lost or duplicated
- **Behavior under allkeys-lru:** Old failed jobs are evicted first, then incomplete jobs

**Structure:**
```
bull:analysis:1                # Job data
bull:analysis:completed        # Completed job set
bull:analysis:failed           # Failed job set
bull:analysis:waiting          # Pending job queue
bull:analysis:active           # Currently processing
```

**Monitoring:**
```bash
# Queue status
redis-cli --eval scripts/bullmq-status.lua

# Check active jobs
redis-cli lrange bull:analysis:active 0 -1

# Count failed jobs
redis-cli scard bull:analysis:failed
```

### 3. Cache: `cache:*`

- **TTL:** Varies by query class (typically 1 hour)
- **Expected volume:** 100–500 MB (depends on data freshness policy)
- **Eviction impact:** LOW — cache misses cause re-queries, but no data loss
- **Behavior under allkeys-lru:** Oldest cache entries are evicted first; frequently-accessed data is retained

**Examples:**
```
cache:movers:gainers        # Movers board (intraday)
cache:screener:filters      # Precalculated filter results
cache:announcements:latest  # Recent disclosure roll-up
```

**Monitoring:**
```bash
# Count cache keys
redis-cli --scan --match 'cache:*' | wc -l

# Estimate total cache size
redis-cli info memory | grep used_memory_human
```

---

## Memory Management & Monitoring

### Alert Thresholds

| Metric | Threshold | Action |
|--------|-----------|--------|
| Used memory | > 80% of maxmemory | Page on-call; review eviction rate |
| Eviction rate | > 1000 keys/min | Investigate sudden load spike or memory leak |
| Failed job backlog | > 10,000 jobs | Manual queue drain required |
| Session count | > 100,000 active | Review session TTL or upgrade instance |

### Key Commands

```bash
# Overall memory stats
redis-cli info memory

# Sample output:
# used_memory_human: 256M
# maxmemory: 1073741824 (1 GB)
# evicted_keys: 15234   # Total keys evicted since startup

# Per-namespace size estimate (rough)
redis-cli dbsize
redis-cli --scan --match 'session:*' | wc -l
redis-cli --scan --match 'bull:*' | wc -l
redis-cli --scan --match 'cache:*' | wc -l

# Eviction metrics
redis-cli info stats | grep evicted_keys
redis-cli info stats | grep keyspace_hits

# Connection count
redis-cli client list | wc -l
redis-cli info clients | grep connected_clients

# Slowlog (queries >1ms by default)
redis-cli slowlog get 10
redis-cli slowlog reset
```

### Prometheus/Grafana Setup (Optional)

If using redis-exporter, key metrics:

```promql
# Memory usage %
redis_memory_used_bytes / redis_config_maxmemory * 100

# Eviction rate
rate(redis_evicted_keys_total[5m])

# Keyspace hits (cache hit %)
redis_keyspace_hits_total / (redis_keyspace_hits_total + redis_keyspace_misses_total)
```

---

## Operational Procedures

### Daily Health Check

Run this from an ops terminal or monitoring dashboard:

```bash
# 1. Check memory usage
MEMORY=$(redis-cli info memory | grep used_memory_bytes | cut -d: -f2)
MAX=$(redis-cli info memory | grep maxmemory | grep -v '0$' | cut -d: -f2)
PCT=$((MEMORY * 100 / MAX))
echo "Memory usage: $PCT%"

# 2. Check for stuck jobs (active for >30 min)
redis-cli llen bull:analysis:active
redis-cli lrange bull:analysis:active 0 -1

# 3. Check session count
redis-cli --scan --match 'session:*' | wc -l

# 4. Alert if eviction rate is high (last hour)
redis-cli info stats | grep evicted_keys
```

### Scenario: Memory Fills Up

**Symptoms:** API requests slow, timeouts, 502 errors, "OOM" in Redis logs.

**Recovery:**

1. **Immediate (< 5 min):**
   - Increase `maxmemory` on the Redis instance if there's headroom on the host.
   - Restart the AI worker(s) to free in-process memory caches.

2. **Short-term (5–30 min):**
   - Drain the failed job queue (see below).
   - Increase TTL on non-critical cache entries (e.g., reduce screener cache from 1h to 15m).
   - Scale down the AI worker if necessary (fewer concurrent jobs = slower queue grow).

3. **Root cause (after incident):**
   - Review queue load over the past 24 hours (Prometheus/CloudWatch).
   - Check if a new job type or feature has increased memory footprint.
   - Upgrade instance size if traffic has outgrown capacity.

### Purging Failed Jobs (Manual Intervention)

If too many failed jobs are filling memory, purge them:

```bash
# Count failed jobs
redis-cli scard bull:analysis:failed

# View a sample
redis-cli smembers bull:analysis:failed | head -5

# Delete ALL failed jobs (careful!)
redis-cli del bull:analysis:failed

# Or delete a range by age (jobs failed >24h ago):
# Use a Lua script or manual inspection, then redis-cli hdel per job id.
```

**Note:** This is destructive; use only in crisis. Normally, failed jobs are cleaned up by the 24h retention policy in ADR-0007.

### Queue Drain Before Schema-Breaking Deploy

Before deploying a schema-breaking BullMQ job change (see docs/ops/queue-deployment-runbook.md):

```bash
# Wait for the queue to empty
while [ $(redis-cli llen bull:analysis:waiting) -gt 0 ]; do
  echo "Waiting for queue... $(redis-cli llen bull:analysis:waiting) jobs remaining"
  sleep 10
done

# Verify no active jobs
redis-cli llen bull:analysis:active

# Check failed queue (may be safe to drain if job is changing)
redis-cli scard bull:analysis:failed

# Now deploy the new schema
```

### Recovery After a Crash

Redis uses AOF (Append-Only File) for durability:

```bash
# If Redis starts with a corrupted AOF log:
redis-cli --rdb /tmp/dump.rdb    # Snapshot current state
redis-server --appendonly no     # Restart with AOF disabled, then restart with AOF

# Or if data is severely corrupted:
rm /data/appendonly.aof          # Delete the corrupted AOF
redis-cli shutdown               # Stop Redis gracefully
# Restart the container; it will start fresh (ok for cache/sessions, keep jobs-in-progress)
```

---

## Related Documentation

- **ADR-0001:** Redis + BullMQ architecture
- **ADR-0004:** S3 claim-check (explains why job payloads are small)
- **ADR-0005:** Session store
- **ADR-0006:** Deployment model (connection URLs)
- **ADR-0007:** Job contract (retention policy: 1h completed, 24h failed)
- **Deployment runbook:** `docs/ops/queue-deployment-runbook.md`

---

## Appendix: Example Monitoring Script

```python
#!/usr/bin/env python3
# monitor-redis.py — emit alerts if thresholds breached

import redis
import sys

r = redis.Redis.from_url('redis://localhost:6379')
info = r.info()

memory_pct = info['used_memory'] / info['maxmemory'] * 100
evicted_keys = info.get('evicted_keys', 0)

print(f"Memory: {memory_pct:.1f}% ({info['used_memory_human']} / {info['maxmemory_human']})")
print(f"Evicted: {evicted_keys} (since startup)")

if memory_pct > 80:
    print("ERROR: Memory > 80%", file=sys.stderr)
    sys.exit(1)

if evicted_keys > 100000:
    print("WARN: Eviction > 100k total", file=sys.stderr)
    sys.exit(0)

sys.exit(0)
```

Run as: `* * * * * python3 /path/to/monitor-redis.py` (cron, every minute).
