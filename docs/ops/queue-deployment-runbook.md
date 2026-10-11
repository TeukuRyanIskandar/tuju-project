# BullMQ Deployment & Queue Safety Runbook

**Status:** Ready for ops team  
**Related:** Issue 25 (bullmq-payload-no-migration-strategy), ADR-0007, ADR-0013

---

## Problem: Schema-Breaking Changes to Job Payloads

BullMQ job envelopes and payloads have **no versioning strategy**. If a required field is added to a job payload (e.g., `TechnicalPayload`), all previously-enqueued jobs **fail validation** when the new worker code processes them.

### Example Scenario

**Current schema (in `packages/contracts`):**
```typescript
export type TechnicalPayload = {
  symbol: string;           // e.g., "MAYBANK"
  timeframe: '1D' | '1W';   // v1 set
};
```

**New schema (after a deploy):**
```typescript
export type TechnicalPayload = {
  symbol: string;
  timeframe: '1D' | '1W';
  newRequiredField: string;  // ← BREAKING CHANGE
};
```

**Result:**
- All jobs enqueued with the old schema are now invalid.
- The Python worker rejects them with a validation error.
- The queue **poisons** — jobs cannot be processed, fail retries, and back up in Redis.
- Manual intervention required: drain failed jobs or roll back the deploy.

---

## Prevention Strategy: Three Options

### Option A: Payload Versioning (Recommended, Future)

**Design:** Add versioning to the job envelope so the worker can handle multiple schema versions.

```typescript
// packages/contracts/src/events.ts
export const JOB_ENVELOPE_VERSION = '1.0';

export type JobEnvelope<P> = {
  jobId: string;
  correlationId: UUID;
  envelopeVersion: string;        // e.g., '1.0'
  payloadVersion: string;         // e.g., 'technical-payload-v1'
  payload: P;
  // ... rest of envelope
};
```

**Worker logic (Python):**
```python
def process_job(envelope: dict) -> JobResult:
    payload_version = envelope.get('payloadVersion', 'technical-payload-v1')
    
    if payload_version == 'technical-payload-v1':
        payload = TechnicalPayloadV1.parse_obj(envelope['payload'])
        # Handle v1 logic
    elif payload_version == 'technical-payload-v2':
        payload = TechnicalPayloadV2.parse_obj(envelope['payload'])
        # New v2 logic, possibly with migration from v1 format
    else:
        raise UnrecoverableError(f"Unknown payload version: {payload_version}")
```

**When to use:** When adding optional fields or backward-incompatible changes. Allows zero-downtime deploys if you add the `payloadVersion` field in advance.

**Implementation status:** Deferred — see ADR-0007 amendment.

---

### Option B: Backward Compatibility (Short-Term, Preferred for Now)

**Design:** Make new fields **optional** with sensible defaults; keep schema changes additive.

**Before deploy:**
```typescript
export type TechnicalPayload = {
  symbol: string;
  timeframe: '1D' | '1W';
};
```

**After deploy (compatible):**
```typescript
export type TechnicalPayload = {
  symbol: string;
  timeframe: '1D' | '1W';
  indicators?: string[];    // ← NEW, optional with default []
  newContext?: Record<string, unknown>;  // ← NEW, optional
};
```

**Worker logic:**
```python
@dataclass
class TechnicalPayload:
    symbol: str
    timeframe: str
    indicators: Optional[List[str]] = None  # Default to None/empty
    new_context: Optional[Dict] = None      # Default to None/empty

    def __post_init__(self):
        if self.indicators is None:
            self.indicators = []
        if self.new_context is None:
            self.new_context = {}
```

**Deployment checklist:**
1. Deploy new worker code that accepts optional fields with defaults.
2. Wait for all in-flight jobs to complete (~5 min to 24 h depending on queue size).
3. Deploy new backend code that starts *enqueuing* jobs with the new fields.
4. Old jobs (without new fields) are handled gracefully; new jobs include them.

**When to use:** Most common for feature additions. Zero downtime, no queue poisoning.

---

### Option C: Queue Drain (Emergency / Last Resort)

**Design:** Ensure the queue is fully drained before deploying schema-breaking changes.

**Pre-deploy checklist:**
```bash
# 1. Stop accepting new jobs (optional: for high-traffic systems)
# Set a feature flag or scale down the backend's ability to enqueue.

# 2. Wait for queue to drain
while [ $(redis-cli llen bull:analysis:waiting) -gt 0 ] || [ $(redis-cli llen bull:analysis:active) -gt 0 ]; do
  echo "Queue status: waiting=$(redis-cli llen bull:analysis:waiting), active=$(redis-cli llen bull:analysis:active)"
  sleep 10
done

# 3. Handle failed jobs (optional: safe to drop if the job schema is changing)
FAILED_COUNT=$(redis-cli scard bull:analysis:failed)
if [ $FAILED_COUNT -gt 100 ]; then
  echo "WARNING: $FAILED_COUNT failed jobs. Consider draining or rolling back."
  redis-cli del bull:analysis:failed  # Or manually review first
fi

# 4. Deploy
# (Backend + worker)

# 5. Restore job acceptance
# Scale backend back up; resume accepting jobs.
```

**When to use:** Major breaking changes or incident recovery. Causes temporary downtime (users cannot enqueue jobs). Not recommended for regular deploys.

---

## Deployment Checklist (Current Standard)

Use **Option B** (backward compatibility) for all schema changes. Follow this checklist:

### Before Code Changes

- [ ] Review the change: is this additive (new optional fields) or breaking?
- [ ] If breaking: **Stop. Plan a versioning strategy first.** Do not proceed with backward-incompatible changes.
- [ ] Create a task/issue to track versioning implementation (Option A, future).

### Phase 1: Deploy Worker (Python)

1. [ ] In `services/ai/`, update `tuju_ai/worker.py` to handle both old and new schemas.
   - Make new fields optional with defaults.
   - Test with both old and new payloads.

2. [ ] In `packages/contracts`, update the TypeScript schema with new *optional* fields.

3. [ ] Deploy the AI worker:
   ```bash
   docker compose up -d --build ai-worker
   ```

4. [ ] Verify the worker starts cleanly:
   ```bash
   docker compose logs ai-worker | grep -i error
   ```

5. [ ] Monitor queue health for 5 minutes:
   ```bash
   # Check for errors
   redis-cli lrange bull:analysis:failed 0 -1
   # Monitor active jobs
   watch 'redis-cli llen bull:analysis:active'
   ```

### Phase 2: Deploy Backend (NestJS)

1. [ ] In `apps/backend/src/jobbus/`, update `job-bus.service.ts` to *enqueue* jobs with new fields.

2. [ ] Rebuild and deploy:
   ```bash
   docker compose up -d --build backend
   ```

3. [ ] Verify the backend starts cleanly:
   ```bash
   docker compose logs backend | grep -i error | grep -v "WARN"
   ```

4. [ ] Verify the `/health` endpoint is green:
   ```bash
   curl http://localhost:3000/health
   ```

5. [ ] Monitor for issues over the next hour:
   - Check for job failures
   - Monitor Redis memory
   - Verify the frontend can still enqueue jobs

### Phase 3: Cleanup (After 24 Hours)

- [ ] Verify no jobs from the old schema remain:
  ```bash
  # Query Redis for old job keys (if they have a distinct pattern)
  redis-cli --scan --match 'bull:analysis:*old-field*'
  ```

- [ ] Optional: Clean up old worker code that handled the previous schema (after one full week to be safe).

---

## Incident Response: Queue Poisoning

**Symptom:** Large spike in failed jobs; error messages like `ValidationError: 'newRequiredField' is required`.

### Immediate (0–5 min)

1. **Stop the pipeline:**
   ```bash
   # Pause backend from enqueuing (feature flag, or scale to 0)
   docker compose up -d --scale backend=0
   ```

2. **Assess damage:**
   ```bash
   redis-cli scard bull:analysis:failed       # Count failed jobs
   redis-cli lrange bull:analysis:failed 0 4  # Sample
   ```

3. **Quick rollback option:**
   ```bash
   # If a recent deploy caused this, roll back:
   git revert HEAD
   docker compose up -d --build ai-worker backend
   ```

### Short-term (5–30 min)

4. **Drain the failed queue (if rollback doesn't apply):**
   ```bash
   # Backup failed jobs for debugging (optional)
   redis-cli smembers bull:analysis:failed > /tmp/failed-jobs-backup.txt
   
   # Delete failed jobs
   redis-cli del bull:analysis:failed
   ```

5. **Verify the queue is healthy:**
   ```bash
   redis-cli llen bull:analysis:waiting       # Should be low
   redis-cli llen bull:analysis:active        # Should be processing
   redis-cli scard bull:analysis:failed       # Should be 0
   ```

6. **Restart the backend:**
   ```bash
   docker compose up -d backend
   ```

### Root Cause (After Incident)

- [ ] Review the deploy that caused the poisoning.
- [ ] Identify why backward compatibility wasn't checked.
- [ ] Add a pre-deploy test: `npm run test:contracts` to validate schema changes.
- [ ] Document the fix in the related issue/PR.

---

## Long-Term Solution: Payload Versioning

**Status:** Tracked in issue m-11 (referenced above).

**Design:** (From ADR-0007 amendment, below)

Once versioning is implemented, future breaking changes are safe:

1. Backend enqueues jobs with a `payloadVersion` field.
2. Worker switches on `payloadVersion` and deserializes appropriately.
3. Multiple schema versions can coexist in the queue.
4. Deploys are zero-downtime and reversible.

**ETA:** TBD (prioritize based on breaking-change frequency).

---

## Monitoring & Alerts

### Key Metrics

| Metric | Alert Threshold | Action |
|--------|-----------------|--------|
| Failed job count | > 100 | Page on-call; check for validation errors in logs |
| Job processing latency | > 30s average | Queue is backed up; may indicate deployment issue |
| Queue size (waiting) | > 5000 jobs | Capacity may be insufficient; consider scaling |
| Worker crash loop | Restart every < 1 min | Likely a breaking change in schema; rollback |

### Example Prometheus Rule

```yaml
- alert: BullMQQueuePoisoned
  expr: increase(bullmq_failed_jobs_total[5m]) > 100
  annotations:
    summary: "BullMQ queue poisoned: {{ $value }} failures in 5 min"
    runbook: "docs/ops/queue-deployment-runbook.md"
```

---

## Related Documentation

- **ADR-0007:** Job contract definition (defines job envelope, retry policy, retention)
- **ADR-0013:** System-triggered AI jobs (extends ADR-0007 for auto-triggers)
- **Redis configuration:** `docs/ops/redis-configuration.md` (memory management if queue fills)
- **Backend context:** `apps/backend/CONTEXT.md` (sole-writer model, job producer role)

---

## Appendix: Testing Schema Changes Locally

```bash
# 1. Make your backward-compatible schema change
# (Add optional fields in packages/contracts/src/events.ts)

# 2. Rebuild and test
pnpm install
pnpm --filter backend test          # Jest unit tests
pnpm --filter contracts test        # Type checks

# 3. Test both old and new payloads
# In services/ai/, add an integration test:
# - Enqueue a job with the old schema (missing new fields)
# - Enqueue a job with the new schema (with new fields)
# - Verify both process successfully

# 4. Boot the stack locally
docker compose up -d
docker compose exec backend npm run migration:run

# 5. Enqueue a test job via curl or the frontend
# Verify it processes successfully in the AI worker logs
docker compose logs ai-worker | tail -20
```

---

## Contact & Escalation

- **On-call engineer:** Page if queue poisioning is detected.
- **Platform lead:** Consulted for payloads versioning roadmap.
- **AI team lead:** If worker behavior differs from spec.
