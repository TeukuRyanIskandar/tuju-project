# m-02: Global entity registration in DataModule erodes encapsulation

**Severity:** Minor  
**Status:** needs-triage  
**Component:** `apps/backend` (NestJS, DI)

## Problem

`DataModule` registers all entities globally and exports `TypeOrmModule`, making every entity available in every importing module without explicit declaration:

```typescript
// data.module.ts:100
TypeOrmModule.forFeature(ENTITIES),  // ALL entities registered globally
```

This means a feature module like `AnalysisModule` can inject `TechnicalAnalysisRepository` without declaring it in its own `imports`, even though it doesn't own that entity. The module's dependencies are implicit.

### Consequences

1. **Encapsulation erosion:** Looking at a module's imports does not tell you which entities it depends on.
2. **Double-registration risk:** Feature modules often re-register a subset of entities (`TypeOrmModule.forFeature([AnalysisResult, ...])`), creating confusion about which registration is active.
3. **Harder to refactor:** Moving an entity to a different module requires auditing all downstream imports; you can't just look at the module's declared imports.

## Fix

Remove the global entity registration and require each feature module to declare its own:

```typescript
// data.module.ts (remove forFeature)
// OR export just the core TypeOrmModule, not entity registrations

// feature.module.ts (explicit)
imports: [
  TypeOrmModule.forFeature([TechnicalAnalysis, FundamentalAnalysis]),
],
```

This follows NestJS best practice: explicit module boundaries.

## Trade-off

This is a style preference, not a correctness issue. The current approach works; it just reduces code clarity.

## Files Affected

- `apps/backend/src/data/data.module.ts` (remove global forFeature)
- Audit all feature modules for implicit entity usage

---
