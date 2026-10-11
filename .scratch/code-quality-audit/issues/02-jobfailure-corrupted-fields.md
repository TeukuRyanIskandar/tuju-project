# C-02: JobFailure emitted with corrupted fields

**Severity:** Critical  
**Status:** completed  
**Component:** `apps/backend` (NestJS)

## Problem

When a job fails in BullMQ, the `JobBus.onFailure` handler (job-bus.service.ts:82–91) constructs a `JobFailure` event with three corrupted fields:

```typescript
this.events.on('failed', ({ jobId, failedReason }) => {
  const failure: JobFailure = {
    correlationId: '',              // ← EMPTY STRING (not a UUID)
    failureClass: 'transient_exhausted',  // ← ALWAYS (never 'terminal')
    retryable: true,                // ← ALWAYS TRUE (contradicts terminal failures)
    ...
  };
```

### Consequences

1. **Invalid correlationId:** The `JobFailure` Zod schema expects `z.uuid()`, so any consumer validating this event will throw.
2. **Wrong failure classification:** All failures are reported as `transient_exhausted` even when they are terminal (e.g., `UnrecoverableError`).
3. **Wrong retryability:** All failures are marked `retryable: true` even when the handler explicitly returns `retryable: false`.
4. **Persisted corruption:** Stores like `TechnicalAnalysisStore.onFailure` consume this event and persist the corrupted fields to the database.

## Root Cause

BullMQ's `'failed'` event does not surface the `correlationId` from the job metadata. The field is always set to empty string as a placeholder. Additionally, there is no downstream logic to distinguish between transient/terminal failures or retryable/non-retryable — all are assumed transient/retryable.

## Fix

1. **Extract correlationId from job metadata:** BullMQ job objects have a `data` property. If `correlationId` was stored in the job payload wrapper (`JobEnvelope`), retrieve it from there.
2. **Surface failure intent:** Pass failure intent (transient vs terminal, retryable vs not) from the handler back into the `JobFailure` event. Requires wiring up to `JobHandler` return value.
3. **Validate at source:** In `TechnicalAnalysisStore.onFailure`, use the `isUuid` check (already done at line 129) as a temporary band-aid, but the root fix is above.

## Files Affected

- `apps/backend/src/jobbus/job-bus.service.ts:82–91` (the corrupt event construction)
- `apps/backend/src/analysis/technical-analysis.store.ts:129–131` (band-aid workaround)
- `apps/backend/src/contracts/JobFailure` (Zod schema, expects uuid)
- `packages/contracts/src/events.ts` (TS type definition)

## Related

- See M-10 (correlationId re-minting) — a downstream consequence of this issue.

---
