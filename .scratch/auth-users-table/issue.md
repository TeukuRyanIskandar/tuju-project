# No `users` Postgres entity — `Watchlist.userId` has no FK

**Severity:** High  
**Status:** ready-for-human  
**Component:** `apps/backend` (database, auth, account provisioning)

## Problem

The `Watchlist` entity holds a `userId` UUID column, but there is **no `users` Postgres table** to foreign-key against:

```typescript
// apps/backend/src/data/entities/watchlist.entity.ts
@Column({ type: 'uuid', name: 'user_id' })
userId!: string;  // No FK constraint — no users table exists
```

### Consequences

1. **Referential integrity missing:** Orphaned `watchlist` rows can accumulate if a user is deleted/purged.
2. **Account provisioning deferred:** New user registration must create a `User` row; currently there is no table to hold it.
3. **Session-only identity:** The `SessionUser` (from Redis session) has no persistent record — the session is the identity authority, with no backing Postgres row.
4. **No per-user limits enforced:** Watchlist item count caps and other account-bound resource limits cannot be enforced at the DB constraint level.

## Design Intent

**Intentional deferral for Phase A.** The session infrastructure (Redis opaque sessions + httpOnly cookie + `AuthGuard`) is complete. The real **authentication** (credential verification, account provisioning, password hashing) is deferred pending a real-auth feature effort (see issue `05-auth-stub-tier-bypass.md`).

The stub login endpoint accepts any claimed `userId` without DB lookup, so there is no user creation flow yet. Account provisioning, user registration, and the `users` Postgres table are all additive future work.

## Related Issues

- `.scratch/code-quality-audit/issues/05-auth-stub-tier-bypass.md` — the auth stub that claims identity without verification; must be replaced when real auth is needed
- ADR-0005 (docs/adr/0005-self-hosted-auth-nestjs-session-tier-capability-seam.md) — session + tier-enforcement architecture

## Roadmap

**Trigger:** When real user registration / account provisioning begins (triggered by implementing issue `05-auth-stub-tier-bypass.md`).

### Implementation Steps

1. **Create `User` entity** (`apps/backend/src/data/entities/user.entity.ts`):
   ```typescript
   @Entity('users')
   export class User {
     @PrimaryColumn('uuid')
     id!: string;

     @Column({ unique: true })
     email!: string;

     @Column()
     hashedPassword!: string;

     @Column({ default: 'free' })
     tier!: Tier;

     @Column({ type: 'timestamp', default: () => 'now()' })
     createdAt!: Date;

     @Column({ type: 'timestamp', default: () => 'now()', onUpdate: () => 'now()' })
     updatedAt!: Date;

     @OneToMany(() => Watchlist, (w) => w.user)
     watchlists!: Watchlist[];
   }
   ```

2. **Add foreign key to `Watchlist`** (via migration):
   ```typescript
   @ManyToOne(() => User, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
   @JoinColumn({ name: 'user_id' })
   user!: User;
   ```

3. **Create migration:** `apps/backend/src/data/migrations/*.ts` — new `users` table + FK on `watchlist.user_id`

4. **Implement `POST /auth/register`** (`apps/backend/src/auth/auth.controller.ts`):
   - Accept email + password
   - Hash password (bcrypt or argon2)
   - Create `User` row
   - Return `SessionUser` + session cookie

5. **Update `POST /auth/login`** to verify against the `users` table:
   - Accept email + password
   - Look up `User` by email
   - Verify password hash
   - Return `SessionUser` + session cookie

6. **Add account provisioning tests:**
   - Duplicate email registration fails
   - Password verification works
   - User tier is read from DB
   - Watchlist FKs enforce existence

---

## Files Affected

- `apps/backend/src/data/entities/user.entity.ts` — new file
- `apps/backend/src/data/entities/watchlist.entity.ts` — add `@ManyToOne` + `@JoinColumn`
- `apps/backend/src/data/migrations/*.ts` — new migration
- `apps/backend/src/auth/auth.controller.ts` — update login/register logic
- `apps/backend/src/auth/session.types.ts` — may extend `SessionUser` with additional fields
- `packages/contracts/src/http/auth.ts` — may extend `SessionUser` Zod schema if needed

---
