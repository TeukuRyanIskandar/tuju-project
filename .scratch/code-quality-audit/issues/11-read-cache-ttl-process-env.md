# M-06: READ_CACHE_TTL_SECONDS read at call-time via process.env

**Severity:** Major  
**Status:** completed  
**Component:** `apps/backend` (NestJS, configuration)

## Verified ✅

Code review of `apps/backend/src/cache/read-cache.service.ts` confirms `READ_CACHE_TTL_SECONDS` is now injected via `AppConfig` at constructor time (not called via `process.env` on every cache operation). The value is validated and parsed during boot in `load-config.ts` following ADR-0006 pattern. Configuration is centralized and type-safe.

## Problem

`ReadCacheService.defaultTtlSeconds` reads `process.env` on every call instead of reading once at boot:

```typescript
// read-cache.service.ts:32–37
get defaultTtlSeconds(): number {
  const parsed = Number(process.env.READ_CACHE_TTL_SECONDS);  // ← called every time
  if (Number.isNaN(parsed)) return 3600;  // default to 1hr
  return parsed;
}

// Usage: called in every .remember() and .set() call
```

### Consequences

1. **Not type-checked at boot:** If `READ_CACHE_TTL_SECONDS` is misconfigured, the error is not discovered until the service first tries to cache something.
2. **Not validated at startup:** No schema validation (e.g., must be positive integer).
3. **Not visible in AppConfig:** The `AppConfig` injection pattern established in ADR-0006 is bypassed, making the config scattered and harder to audit.
4. **Runtime string-to-number conversion:** Every cache operation does string parsing; a malformed env var causes silent fallback to 3600s without logging.

## Design Pattern

ADR-0006 establishes that all config should be resolved once via `loadConfig()` and injected as `AppConfig`. Compare with correct usage:

```typescript
// AppConfigService (correct)
get redisUrl(): string {
  return this.config.redis.url;  // resolved at boot
}
```

## Fix

1. **Add to AppConfig:**
   ```typescript
   // config.ts
   export interface AppConfig {
     cache: {
       readTtlSeconds: number;  // resolved at boot, validated
     };
   }
   
   // loadConfig()
   cache: {
     readTtlSeconds: Number(
       required(process.env.READ_CACHE_TTL_SECONDS, 'number (seconds)'),
     ),
   }
   ```

2. **Update ReadCacheService:**
   ```typescript
   constructor(private appConfig: AppConfig) {}
   
   get defaultTtlSeconds(): number {
     return this.appConfig.cache.readTtlSeconds;  // read once at boot
   }
   ```

## Files Affected

- `apps/backend/src/cache/read-cache.service.ts:32–37` (remove process.env access)
- `apps/backend/src/config/config.ts` (add cache.readTtlSeconds to AppConfig)
- `apps/backend/src/config/load-config.ts` (validate and parse at boot)

---
