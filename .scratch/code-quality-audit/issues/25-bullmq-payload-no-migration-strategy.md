# m-11: No BullMQ payload migration strategy — queue versioning absent

**Severity:** Minor  
**Status:** ready-for-human  
**Component:** Cross-cutting (architecture, queue design)

## Problem

BullMQ job payloads have no versioning strategy for schema-breaking changes. If a required field is added to `TechnicalPayload` (for example), all previously-enqueued jobs in the queue (and failed jobs retained for 24h) will fail validation:

```typescript
// payloads.ts (current)
TechnicalPayload: z.object({
  symbol: z.string(),
  timeframe: z.enum(['1D', '1W']),
});

// Future (breaking change)
TechnicalPayload: z.object({
  symbol: z.string(),
  timeframe: z.enum(['1D', '1W']),
  newRequiredField: z.string(),  // ← all old jobs now fail
});
```

### Consequences

1. **Queue poison:** A schema-breaking deploy makes all old jobs unprocessable.
2. **Manual intervention required:** Ops must manually drain and purge the failed job queue, or roll back the deploy.
3. **No dead-letter queue:** Unparseable jobs are dropped, not preserved for debugging.
4. **No rollback procedure:** There's no documented way to safely roll back a schema change.

## Design Pattern

ADR-0007 defines the `JobEnvelope` and `JobResult` shapes but contains no versioning strategy. Compare with artifacts, which have `schemaVersion` (though scattered — see issue m-08).

## Fix

**Option A: Add envelope versioning (comprehensive)**
```typescript
// packages/contracts/src/events.ts
export const JOB_ENVELOPE_VERSION = 'job-envelope-1';

export type JobEnvelope<P> = {
  jobId: string;
  correlationId: UUID;
  envelopeVersion: typeof JOB_ENVELOPE_VERSION;  // ← version the envelope
  payloadVersion: 'technical-payload-1' | 'fundamental-payload-1' | ...;
  payload: P;
};
```

Then the worker can handle migrations:
```python
if envelope.payloadVersion == 'technical-payload-1':
    validate_against_technical_payload_v1(envelope.payload)
elif envelope.payloadVersion == 'technical-payload-2':
    validate_against_technical_payload_v2(envelope.payload)
    # Possibly migrate from v1 format if needed
```

**Option B: Add a dead-letter queue (interim)**
```typescript
// All unparseable jobs go to a DLQ instead of being dropped
queue.on('error', (err) => {
  if (err.code === 'UNPARSEABLE_PAYLOAD') {
    deadLetterQueue.add(job);
  }
});
```

**Option C: Document a deployment checklist (short-term)**
```markdown
# Deployment Checklist: Queue-Safe Schema Changes

Before deploying a schema-breaking change:
1. Ensure the queue is drained (all jobs processed)
2. Or add backward compatibility: make new fields optional, add default values
3. Keep the old worker version running until old jobs are expired (24h)
4. If impossible, manually drain failed jobs: redis-cli del bull:analysis:failed
```

## Files Affected

- `packages/contracts/src/events.ts` (add version fields)
- `services/ai/src/tuju_ai/worker.py` (add migration logic)
- `apps/backend/src/jobbus/job-bus.service.ts` (set versions when enqueuing)
- Create: `docs/ops/queue-deployment-runbook.md` (deployment checklist)

## Related

- ADR-0007 (job contract definition — should include versioning strategy)
- Issue m-08 (schemaVersion strings — similar problem)

---
