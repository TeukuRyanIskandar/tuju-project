# C-05: Auth stub accepts any claimed tier — deferred PoC risk (wontfix)

**Severity:** Critical  
**Status:** wontfix  
**Component:** `apps/backend` (NestJS, auth)

## Problem

The login endpoint accepts any caller-claimed `userId` and `tier` without credential verification:

```typescript
@Post('login')
async login(
  @Body() body: { userId?: string; tier?: Tier },
  ...
): Promise<SessionUser> {
  const user: SessionUser = {
    userId: body.userId ?? 'stub-user',
    tier: body.tier ?? 'free',  // ← caller can claim any tier
  };
  // ... issue session cookie
}
```

### Consequences

1. **Complete tier bypass:** Any caller can `POST /auth/login` with `{ tier: 'premium' }` and gain premium privileges.
2. **Shared identity:** All concurrent browser sessions from the same caller share the same `userId`, allowing cross-session interference.
3. **No credential verification:** No password, SAML, OAuth, API key, or any other proof required.

## Design Intent

This is an **intentional PoC stub**. The comment on line 41 says "a feature effort adds real verification." The project is in Phase A (free tier only) with tier gating enforced at the `@RequiresJob` decorator level; paid features are not yet accessible.

## Acceptance

Flagged as `wontfix` because:
- This is a known PoC limitation documented in the code
- Real auth is a planned feature effort (not tracked in this issue)
- The tier enforcement at `TierGuard` + `JobBus.enqueue` level is a secondary gate
- The risk is accepted for the current demo phase

## Roadmap

When the `pro`/`premium` tier feature is activated, this stub **must be replaced** with real credential verification (OAuth, SAML, session tokens, or similar). At that point, this issue should be reopened as `ready-for-human`.

## Trigger Condition

Reopen this issue as `ready-for-human` when **any of the following is true:**
1. Product A begins accepting paying `pro`/`premium` tier users
2. An external production deployment with real users is imminent (requires the users table and credential verification)
3. A decision is made to support per-user authentication (currently the login endpoint accepts any claimed identity)

**Activation checklist at that time:**
- [ ] Create `User` Postgres entity with email + hashed password
- [ ] Replace `LoginRequestDto` with real credential fields (email + password, or OAuth provider)
- [ ] Add password hashing (bcrypt or argon2)
- [ ] Implement `POST /auth/register` for account creation
- [ ] Implement password reset flow (or use OAuth)
- [ ] Add integration tests for credential verification
- [ ] Retest tier gating with real user registration

---
