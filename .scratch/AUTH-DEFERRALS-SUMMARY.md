# Auth Deferrals — Formal Tracking Summary

**Date:** Oct 11, 2026  
**Status:** Formalized deferred work into `.scratch` issues with clear trigger conditions and implementation checklists

---

## Overview

Authentication and account provisioning in the tuju-project are **intentionally deferred for Phase A** (free-tier PoC). The session infrastructure (Redis + httpOnly cookies + tier gating) is complete and durable. The **user registration and credential verification** are additive future work, triggered when real-user adoption or paid-tier activation begins.

This document formalizes the deferrals and provides clear implementation roadmaps.

---

## Summary of Changes

### 1. Fixed: `COOKIE_SAMESITE` validation ✅

**Status:** `completed`  
**Issue:** `.scratch/code-quality-audit/issues/19-cookie-samesite-unvalidated-cast.md`  
**Change:** Updated issue to reflect that the fix was already implemented in `apps/backend/src/config/config.ts:44–52` with a proper `parseCookieSameSite()` validation function.

**What was done:** Invalid env vars now throw a descriptive error at boot, preventing silent misconfiguration.

---

### 2. Updated: Auth stub tier-bypass issue with trigger condition

**Status:** `wontfix` → trigger to `ready-for-human`  
**Issue:** `.scratch/code-quality-audit/issues/05-auth-stub-tier-bypass.md`  
**Change:** Added `## Trigger Condition` section that explicitly states when this issue should be reopened as `ready-for-human`:

- Product A begins accepting paying `pro`/`premium` tier users, OR
- External production deployment with real users is imminent, OR
- Decision is made to support per-user authentication

**Activation checklist:** Created at that point (User entity, credential fields, password hashing, registration endpoint, integration tests, tier gating retest).

---

### 3. Created: "No `users` table" issue

**Status:** `ready-for-human`  
**Issue:** `.scratch/auth-users-table/issue.md` (NEW)  
**Trigger:** Same as auth stub (when real account provisioning begins)

**What it covers:**
- The `Watchlist.userId` has no FK because no `users` table exists
- Why it's deferred: session-only identity is sufficient for Phase A
- Implementation steps: `User` entity creation, migration, FK addition to Watchlist
- Related to: `05-auth-stub-tier-bypass.md` + ADR-0005

**Files affected:** 6 files (entity, migration, auth controller, types, contracts)

---

### 4. Created: "No registration endpoint or signup UI" issue

**Status:** `ready-for-human`  
**Issue:** `.scratch/auth-registration-flow/issue.md` (NEW)  
**Trigger:** Same as both above (when real user signup begins)

**What it covers:**
- Backend: `POST /auth/register` endpoint missing; `POST /auth/login` currently accepts any claimed identity
- Frontend: No login/signup/logout pages, no user profile, no password reset
- Why it's deferred: stub login is end-to-end exercisable for demo; real flows are Phase B
- Implementation steps: register endpoint, password hashing, login update, frontend pages, session management UI
- Detailed checklists for both backend and frontend

**Files affected:** 9 files (controller, DTO, utils, frontend pages, query helpers)

---

## Auth Deferral Dependency Chain

```
Issue 05 (auth stub tier-bypass)
├── Issue: Users table (auth-users-table)
└── Issue: Registration flow (auth-registration-flow)
    ├── POST /auth/register endpoint
    ├── POST /auth/login credential verification
    ├── Password hashing utilities
    ├── User entity + FK on Watchlist
    ├── Frontend login page
    ├── Frontend signup page
    └── User profile / logout UI
```

**Trigger:** Any of these begins when real-user adoption or paid-tier activation requires it. They are **mutually dependent** — implement together as one effort.

---

## What Is Already Complete (Durable)

The following auth infrastructure is **not deferred** and will not change:

1. **Session management** (`src/auth/session.store.ts`) — Redis opaque sessions, instant revocation
2. **Cookie flags** (`src/auth/auth.controller.ts`) — httpOnly/Secure/SameSite correctly set
3. **Global AuthGuard** (`src/auth/auth.guard.ts`) — resolves `req.user` from session
4. **TierGuard + tier-policy** (`src/auth/tier-policy.ts`, `tier.guard.ts`) — capability-based enforcement at enqueue seam
5. **Frontend auth integration** (`src/lib/auth.ts`, `src/api/auth.ts`) — session fetch, tier read, capability checks
6. **Contracts** (`packages/contracts/src/http/auth.ts`) — `SessionUser` Zod schema, type definitions

These pieces need **zero changes** for Phase A. They are the foundation.

---

## Roadmap

| Effort | Trigger | Est. Duration | Dependencies |
|---|---|---|---|
| **Phase A (Current)** | Completed | ✅ | None |
| **Phase B: Real Auth** | Paid-tier or prod launch | ~2–3 weeks | All three issues |
| **Phase C: Advanced Auth** | Multi-user orgs / SAML | ~1–2 months | CASL integration (ADR-0005 escape hatch) |

---

## ADR References

- **ADR-0005:** Self-hosted auth in NestJS, session + tier-enforcement architecture, explicit deferrals
- **ADR-0006:** Connection-URL-by-env invariant (all external dependencies via env vars)
- **ADR-0009:** Secrets management (AWS SSM fetch on boot in prod)
- **ADR-0010:** Structured logging with `correlationId`

---

## Next Steps

1. **For Phase A (now):** Use the stub auth as-is. No changes needed.
2. **When real-user adoption approaches:**
   - Reopen issue `05-auth-stub-tier-bypass.md` as `ready-for-human`
   - Activate the checklists in `auth-users-table/issue.md` and `auth-registration-flow/issue.md`
   - Implement in dependency order: users table → register endpoint → login UI

---

## Questions?

Refer to:
- `.scratch/code-quality-audit/issues/05-auth-stub-tier-bypass.md` — current stub rationale
- `.scratch/auth-users-table/issue.md` — database + credential verification design
- `.scratch/auth-registration-flow/issue.md` — full frontend + backend signup/login flows
- `docs/adr/0005-self-hosted-auth-nestjs-session-tier-capability-seam.md` — architectural context

All three issues have related-issue cross-references and implementation checklists ready to activate.
