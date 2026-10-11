# m-03: TechnicalAnalysis.instrumentId missing explicit @Index()

**Severity:** Minor  
**Status:** needs-triage  
**Component:** `apps/backend` (TypeORM, database schema)

## Problem

`TechnicalAnalysis.instrumentId` has a `@Unique` constraint but no explicit `@Index()`:

```typescript
// technical-analysis.entity.ts:24–25
@Column({ type: 'uuid', name: 'instrument_id' })
instrumentId!: string;

// Later in the entity:
@Unique('idx_technical_analysis_instrument_id', ['instrumentId'])
```

### Consequences

1. **Plan ambiguity:** TypeORM's `@Unique` creates a unique constraint, but does not guarantee a B-tree index is created. Some databases create an index as a side effect; others do not. Postgres's query planner may not use the unique constraint for point lookups without an explicit index.
2. **Perf regression risk:** A `findOne({ where: { instrumentId } })` query may do a table scan instead of an index seek if the planner doesn't recognize the unique constraint as indexable.
3. **Unclear intent:** A reader doesn't know if the unique constraint is the only guard or if an index is also present.

## Verification

Check the generated migration to see if an explicit index was created:

```bash
# In migration file (1728300000000-TechnicalAnalysis.ts)
# Look for: createIndex or CREATE INDEX statement
```

## Fix

Add an explicit `@Index()` decorator:

```typescript
@Index()
@Column({ type: 'uuid', name: 'instrument_id' })
instrumentId!: string;
```

Or use `@Unique` with an index flag (if TypeORM supports it):

```typescript
@Unique({ name: 'idx_technical_analysis_instrument_id' })
@Index()
@Column({ type: 'uuid', name: 'instrument_id' })
instrumentId!: string;
```

## Files Affected

- `apps/backend/src/data/entities/technical-analysis.entity.ts:24–25`
- `apps/backend/src/data/entities/fundamental-analysis.entity.ts` (same pattern likely present)
- Generated migration may need regeneration

## Related

- Issue C-4 (N+1 queries): improved indexing helps performance

---
