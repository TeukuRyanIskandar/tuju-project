# m-01: Job id format mismatch — TS hyphen vs Python colon

**Severity:** Minor  
**Status:** needs-triage  
**Component:** `apps/backend` (NestJS), `services/ai` (Python worker)

## Problem

BullMQ job ids are minted with different delimiters on each side:

**NestJS (TS):**
```typescript
// job-bus.service.ts:185–188
const jobId = `ta-${stockCode}-${timeframe}-${dateStr}`;  // ← hyphen-delimited
```

**Python worker:**
```python
# ta_fa_analysis.py:353
JobResult(jobId=f"technical:{symbol}:{timeframe}:{dateStr}")  # ← colon-delimited
```

Both formats are documented in comments (e.g., `config.py:33`) to be intentional — the dedup id (TS) is different from the result id (Python). However, the parsing functions use **different delimiters and different indices**:

```typescript
// stock-code-from-job-ids.ts
export function stockCodeFromTechnicalBullJobId(jobId: string): string {
  const parts = jobId.split('-');  // hyphen
  return parts[1];  // 2nd part (index 1)
}

export function stockCodeFromTechnicalJobResultId(jobId: string): string {
  const parts = jobId.split(':');  // colon
  return parts[1];  // 2nd part (index 1)
}
```

### Consequences

1. **Fragility:** Stock codes containing hyphens (unlikely but possible for extended codes) would extract the wrong token.
2. **Two parsing code paths:** Future maintainers must keep both paths in sync; a bug in one is invisible to the other.
3. **No central registry:** The format strings are scattered; a format change requires grepping multiple files.

## Fix

**Option A: Unified delimiter (safest)**
```typescript
// Use colon everywhere
const jobId = `ta:${stockCode}:${timeframe}:${dateStr}`;
// Single parsing function for both id types
```

**Option B: Central registry (if split is intentional)**
```typescript
// job-id-formats.ts
const TECHNICAL_JOB_ID_PATTERN = /^ta-([A-Z0-9]+)-(\w+)-(.+)$/;
const TECHNICAL_JOB_RESULT_PATTERN = /^technical:([A-Z0-9]+):(\w+):(.+)$/;

export function stockCodeFromTechnicalBullJobId(jobId: string): string {
  const match = jobId.match(TECHNICAL_JOB_ID_PATTERN);
  return match?.[1] ?? null;
}
```

## Files Affected

- `apps/backend/src/jobbus/job-bus.service.ts:185–188` (job id format)
- `services/ai/src/tuju_ai/ta_fa_analysis.py:353` (result id format)
- `apps/backend/src/stocks/stock-code-from-job-ids.ts` (parsing)
- `apps/backend/src/analysis/analysis-reference.ts` (if id parsing is used here)

---
