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

---
