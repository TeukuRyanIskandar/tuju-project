# m-07: updatedAt manually managed instead of @UpdateDateColumn

**Severity:** Minor  
**Status:** needs-triage  
**Component:** `apps/backend` (TypeORM, schema design)

## Problem

`ProspectusAnalysis` and `TechnicalAnalysis` entities manually manage the `updatedAt` column:

```typescript
// prospectus-analysis.entity.ts:72–73
@Column({ type: 'timestamptz', name: 'updated_at', default: () => 'now()' })
updatedAt!: Date;

// Comment says: "Bumped on every re-run upsert (set explicitly by the store)"
```

The comment indicates the field is set explicitly by the store, but there is no guard to ensure this happens. If a developer forgets to update `updatedAt` during an upsert, the column stays at its insertion time.

### Consequences

1. **Footgun:** The manual approach is error-prone; it relies on developer discipline.
2. **Stale metadata:** If `updatedAt` is not bumped, downstream logic (e.g., cache invalidation) may use incorrect timestamps.
3. **TypeORM offers a better pattern:** `@UpdateDateColumn` automatically updates on every save.

## Fix

Use TypeORM's `@UpdateDateColumn` decorator:

```typescript
import { UpdateDateColumn } from 'typeorm';

@UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
updatedAt!: Date;

// Now TypeORM automatically sets this on every save
```

This removes the need for manual updates and eliminates the footgun.

## Trade-off

`@UpdateDateColumn` is automatically set by TypeORM on every entity save. If the entity is updated by a raw SQL query (e.g., `manager.query(...)`), `@UpdateDateColumn` is **not** triggered. Check that all updates go through the ORM's `save()` method, not raw queries.

## Files Affected

- `apps/backend/src/data/entities/prospectus-analysis.entity.ts:72–73`
- `apps/backend/src/data/entities/technical-analysis.entity.ts:60–61` (likely same pattern)
- `apps/backend/src/data/entities/fundamental-analysis.entity.ts` (likely same pattern)
- Verify all persisting code uses `.save()` not raw queries

---
