# m-10: Cron CronExpression.EVERY_DAY_AT_8PM + timeZone interplay unverified

**Severity:** Minor  
**Status:** needs-triage  
**Component:** `apps/backend` (NestJS, scheduling)

## Problem

The nightly EOD ingest is triggered via cron with a timezone conversion that may not work as intended:

```typescript
// ingestion.scheduler.ts:43–45
@Cron(CronExpression.EVERY_DAY_AT_8PM, {
  name: 'nightly-eod-ingest',
  timeZone: 'Asia/Kuala_Lumpur',
})
async onNightlyIngest() { ... }
```

`@nestjs/schedule` uses the `node-cron` library, which supports the `timeZone` option. However:

1. **Pre-built expressions:** `CronExpression.EVERY_DAY_AT_8PM` is a string constant (likely `0 20 * * *` in UTC or system time).
2. **Timezone interaction unclear:** It's not documented whether `node-cron` first interprets the expression in system timezone, then converts to `Asia/Kuala_Lumpur`, or vice versa.
3. **Docker timezone:** If the Docker container has no `TZ` environment variable set, the system timezone defaults to UTC, and the conversion behavior is unpredictable.

### Consequences

1. **Wrong fire time:** If the conversion is done in the wrong order, the cron job might fire at a different time than expected (e.g., 12:20 UTC instead of 20:00 MYT).
2. **Silent misbehavior:** Without alerting, the ingest could run at the wrong time and go unnoticed until market opening.

## Verification

Test the actual fire time:

```typescript
// Test code to add to the cron-isolation.spec.ts
test('nightly-ingest fires at correct MYT time', async () => {
  // Mock the cron trigger
  // Verify it fires at the right wall-clock time
  // Account for MYT = UTC+8
});
```

## Fix

**Option A: Explicit UTC cron (safest)**
```typescript
// 20:00 MYT = 12:00 UTC (MYT is UTC+8)
@Cron('0 12 * * *', {  // UTC
  name: 'nightly-eod-ingest',
})
async onNightlyIngest() { ... }
```

**Option B: Set container timezone**
```yaml
# docker-compose.yml
services:
  backend:
    environment:
      TZ: Asia/Kuala_Lumpur
    # Now CronExpression.EVERY_DAY_AT_8PM will work as expected
```

**Option C: Use explicit cron with timeZone (verify it works)**
```typescript
@Cron('0 20 * * *', {  // 20:00 in the specified timezone
  name: 'nightly-eod-ingest',
  timeZone: 'Asia/Kuala_Lumpur',
})
```

Then add a test to verify the firing time.

## Files Affected

- `apps/backend/src/ingestion/ingestion.scheduler.ts:43–45` (cron definition)
- `docker-compose.yml` (optionally set TZ env var)
- `apps/backend/src/**/__tests__/cron-isolation.spec.ts` (add timing verification test)

## Related

- Ops documentation: Cron schedule and timezone handling

---
