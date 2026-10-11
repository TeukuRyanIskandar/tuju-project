# m-08: schemaVersion strings scattered with no version registry

**Severity:** Minor  
**Status:** needs-triage  
**Component:** Cross-cutting (TypeScript, Python)

## Problem

Artifact `schemaVersion` strings are hard-coded in multiple places with no central registry:

```typescript
// prospectus/analysis.py:55
"schemaVersion": "prospectus-at-a-glance-1"

// ta_fa_analysis.py:433
"schemaVersion": "technical-analysis-1"

// ta_fa_analysis.py:564
"schemaVersion": "fundamental-analysis-1"

// packages/contracts/src/artifact.ts
Literal['technical-analysis-1']
Literal['fundamental-analysis-1']
Literal['prospectus-at-a-glance-1']
```

### Consequences

1. **No version-bump strategy:** To bump a schema version (e.g., `technical-analysis-1` → `technical-analysis-2`), you must grep across TS and Python files and edit each one.
2. **Drift risk:** A TS-side version bump can be made without updating the Python side, causing schema validation failures at runtime.
3. **No migration path:** There's no way to handle old versions in the read side or define a deprecation timeline.
4. **No test coverage:** The contract-generation pipeline doesn't verify that all Python string literals match the Zod literals.

## Fix

**Option A: Central registry (recommended)**
```typescript
// packages/contracts/src/schema-versions.ts
export const SCHEMA_VERSIONS = {
  technical: 'technical-analysis-1',
  fundamental: 'fundamental-analysis-1',
  prospectus: 'prospectus-at-a-glance-1',
  brief: 'brief-1',
} as const;

// Re-export in contracts barrel
export * from './schema-versions';
```

Then generate Python constants from this:

```bash
# During codegen
SCHEMA_VERSIONS = {
    'technical': 'technical-analysis-1',
    'fundamental': 'fundamental-analysis-1',
    'prospectus': 'prospectus-at-a-glance-1',
    'brief': 'brief-1',
}
```

**Option B: Add version-bump test**
```typescript
// contracts.spec.ts
test('all schemaVersion strings match contract definitions', () => {
  const pythonVersions = require('services/ai/src/tuju_ai/schema-versions');
  const tsVersions = SCHEMA_VERSIONS;
  expect(pythonVersions).toEqual(tsVersions);
});
```

## Files Affected

- Create: `packages/contracts/src/schema-versions.ts`
- `packages/contracts/src/artifact.ts` (import from schema-versions)
- `services/ai/src/tuju_ai/prospectus/analysis.py` (import from generated constants)
- `services/ai/src/tuju_ai/ta_fa_analysis.py` (import from generated constants)
- `services/ai/src/tuju_ai/handler.py` (import from generated constants)

## Testing Opportunity

Add a test: `test_schema_versions_ts_and_python_in_sync()` to fail on drift.

---
