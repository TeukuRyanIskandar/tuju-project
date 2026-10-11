# m-04: Watchlist entity missing @Unique on userId

**Severity:** Minor  
**Status:** needs-triage  
**Component:** `apps/backend` (TypeORM, schema design)

## Problem

The `Watchlist` entity has no unique constraint on `userId`, despite the domain model stating "one account-bound watchlist per user":

```typescript
// watchlist.entity.ts:26–27
@Column({ type: 'uuid', name: 'user_id' })
userId!: string;

// No @Unique constraint on userId
```

Per the CONTEXT.md glossary: "User → Watchlist → Instrument" (one watchlist per user).

### Consequences

1. **Silent data corruption:** If watchlist creation is retried or double-clicked, multiple watchlists can be created for the same user.
2. **Query ambiguity:** Code that assumes one watchlist per user (e.g., `getUserWatchlist()`) may return multiple rows or require defensive `LIMIT 1`.
3. **Future bug:** When the watchlist feature is activated, the lack of a DB constraint means the application layer must guard against duplicates, and testing won't catch a regression.

## Fix

Add a unique constraint to the entity:

```typescript
@Entity()
@Unique(['userId'])  // or @Unique('idx_watchlist_user_id', ['userId'])
export class Watchlist {
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;
  ...
}
```

Then regenerate the migration:

```bash
npm run typeorm migration:generate -- src/migrations/AddWatchlistUserIdUnique
```

## Files Affected

- `apps/backend/src/data/entities/watchlist.entity.ts` (add @Unique)
- Generated migration file (will be created by typeorm)

## Note

The watchlist feature is not yet implemented; this is a preventive fix for when it is.

---
