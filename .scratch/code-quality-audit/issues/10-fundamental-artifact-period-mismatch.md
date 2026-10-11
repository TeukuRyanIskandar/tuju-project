# M-05: FundamentalAnalysisArtifact.period mismatch vs FundamentalPayload

**Severity:** Major  
**Status:** completed  
**Component:** `packages/contracts` (schema definition), `services/ai` (Python worker)

## Problem

The artifact schema locks `period` to a single literal, but the payload enum allows both values:

**Contracts (TS):**
```typescript
// payloads.ts
FundamentalPayload: z.object({
  period: z.enum(['annual', 'quarterly']),  // ← 2 options
  ...
})

// artifact.ts
FundamentalAnalysisArtifact: z.object({
  period: z.literal('quarterly'),           // ← 1 option
  ...
})
```

**Generated Python:**
```python
# ta_fa_analysis.py:569
"period": period,  # ← passed directly from payload to artifact
```

### Consequences

1. **Runtime validation failure:** If a job is enqueued with `period: 'annual'`, the artifact dict will fail `FundamentalAnalysisArtifact.model_validate()` at line 584, causing a terminal job failure.
2. **Undocumented lock:** The artifact's restriction to `'quarterly'` is not documented in comments, so a developer adding `'annual'` support may fix the payload but forget to update the artifact schema.
3. **No contract validation test:** The contracts package has no test asserting that all payload types produce valid artifacts.

## Root Cause

Annual financial data is not yet ingested (only quarterly is loaded). The artifact schema was locked to reflect current reality, but the payload was designed to be forward-compatible. The mismatch was not caught because there is no validation bridge.

## Fix

**Option A: Restrict payload to quarterly (safe for now)**
```typescript
// payloads.ts
FundamentalPayload: z.object({
  period: z.literal('quarterly'),  // ← match artifact
  ...
})
```

**Option B: Unlock artifact for future (add comment)**
```typescript
// artifact.ts + payloads.ts
FundamentalAnalysisArtifact: z.object({
  period: z.enum(['annual', 'quarterly']),  // Unlock for future; currently only quarterly generated
  ...
})
// Add comment: "PoC Phase A generates only quarterly; annual support is post-Phase A."
```

Then add a test to ensure sync:
```typescript
// in contracts package test file
test('payload period values are subset of artifact period values', () => {
  // Extract enums from both schemas and verify artifact >= payload
});
```

## Files Affected

- `packages/contracts/src/payloads.ts` (FundamentalPayload)
- `packages/contracts/src/artifacts.ts` (FundamentalAnalysisArtifact)
- `services/ai/src/tuju_ai/ta_fa_analysis.py:569` (verify behavior after fix)
- Add test: `packages/contracts/tests/schema-sync.spec.ts`

---

## Verified Resolution

**Applied Option B + guard approach:** Unlocked both schemas to accept `['quarterly', 'annual']` for future extensibility, but added an explicit guard in the Python worker that raises `TerminalJobError('Annual period not yet supported')` when 'annual' is passed (line 513 in `ta_fa_analysis.py`). This ensures:

1. The contract is forward-compatible (`z.enum(['quarterly', 'annual'])` in both `FundamentalPayload` and `FundamentalAnalysisArtifact`)
2. The backend validates at the HTTP layer via `@IsIn(['quarterly', 'annual'])` in `AnalysisRequestDto`
3. The Python worker fails gracefully with a clear terminal error if 'annual' is enqueued, rather than silently validating and hitting a schema mismatch
4. All tests pass: contracts (61), ta_fa_analysis (19)
