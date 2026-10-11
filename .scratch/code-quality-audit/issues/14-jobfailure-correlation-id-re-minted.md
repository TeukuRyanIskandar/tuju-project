# M-09: correlationId silently re-minted on failure — severs trace chain

**Severity:** Major  
**Status:** completed  
**Component:** `apps/backend` (NestJS, error handling)

## Verified ✅

Code review of `apps/backend/src/job/job-bus.service.ts` confirms `correlationId` is now extracted from the job data envelope (via `job.data.correlationId`) during the 'failed' event handler. The `randomUUID()` fallback is used only when the envelope lacks a correlationId. Trace chains are now preserved end-to-end from request → job enqueue → job failure → stored result.

## Problem

When a job fails, `TechnicalAnalysisStore.onFailure` (and similar stores) receives a `JobFailure` event with an empty string as `correlationId` (issue C-2). The store then generates a new random UUID:

```typescript
// technical-analysis.store.ts:129–131
const correlationId =
  existing?.correlationId ??
  (isUuid(failure.correlationId) ? failure.correlationId : randomUUID());
```

### Consequences

1. **Broken trace correlation:** The failure stored in Postgres has a random `correlationId` unrelated to any request in the logs.
2. **Lost audit trail:** Tracing a failed analysis from user request → job enqueue → job failure → stored result becomes impossible.
3. **Band-aid, not fix:** This code is a workaround for the root issue (C-2: `JobFailure.correlationId` is always empty).

## Root Cause

See issue C-2 (JobFailure corrupted fields). The `JobBus.onFailure` handler constructs `correlationId: ''` because BullMQ's `'failed'` event does not surface job metadata.

## Fix

Fix C-2 first (extract correlationId from job metadata). Once the `JobFailure` event carries the correct correlationId, this store can use it directly:

```typescript
const correlationId = failure.correlationId;  // trust the event
```

## Files Affected

- `apps/backend/src/analysis/technical-analysis.store.ts:129–131` (simplify after C-2 is fixed)
- `apps/backend/src/analysis/fundamental-analysis.store.ts` (same pattern)
- `apps/backend/src/analysis/prospectus-analysis.store.ts` (same pattern)

## Related Issues

- C-2 (JobFailure corrupted fields) — root cause

---
