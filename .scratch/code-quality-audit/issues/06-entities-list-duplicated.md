# M-01: Entities list duplicated between data.module.ts and data-source.ts

**Severity:** Major  
**Status:** needs-triage  
**Component:** `apps/backend` (NestJS, TypeORM)

## Problem

The `ENTITIES` array is copy-pasted verbatim in two separate files:

- `apps/backend/src/data/data.module.ts:43–68`
- `apps/backend/src/data/data-source.ts:50–75`

The comment on line 41 of `data.module.ts` says "which must stay in sync," but there is no compile-time or runtime check to enforce this. The same issue applies to the `MIGRATIONS` array.

```typescript
// data.module.ts
const ENTITIES = [
  User, Tier, Company, Instrument, ...
];

// data-source.ts
const ENTITIES = [
  User, Tier, Company, Instrument, ...  // ← copy-pasted, can diverge silently
];
```

### Consequences

1. **Schema divergence:** If an entity is added to one file but not the other, the CLI migrations (`typeorm migration:generate`, `typeorm migration:run`) operate on a different schema than the running application.
2. **Silent corruption:** The mismatch is only discovered at runtime when the app tries to save an entity that the CLI's migration doesn't know about, or vice versa.
3. **Maintenance burden:** Every new entity requires two edits; forgetting one is a sneaky bug.

## Fix

Export `ENTITIES` and `MIGRATIONS` from a shared source (e.g., `src/data/entities/index.ts`), then import in both places:

```typescript
// src/data/entities/index.ts
export const ENTITIES = [
  User, Tier, Company, Instrument, ...
];
export const MIGRATIONS = [
  InitialSchema1728300000000, ...
];

// data.module.ts
import { ENTITIES, MIGRATIONS } from './entities';
TypeOrmModule.forRoot({
  entities: ENTITIES,
  migrations: MIGRATIONS,
});

// data-source.ts
import { ENTITIES, MIGRATIONS } from './entities';
const dataSource = new DataSource({
  entities: ENTITIES,
  migrations: MIGRATIONS,
});
```

This ensures a single point of truth. TypeScript will catch any missing exports at compile time.

## Files Affected

- `apps/backend/src/data/data.module.ts:43–68`
- `apps/backend/src/data/data-source.ts:50–75`
- Create new file: `apps/backend/src/data/entities/index.ts` (or similar)

## Testing Opportunity

Add a type-level test: `const _: typeof ENTITIES = dataSource.options.entities` to ensure they stay in sync.

---
