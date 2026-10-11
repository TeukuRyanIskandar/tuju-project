# No registration endpoint or signup UI

**Severity:** High  
**Status:** ready-for-human  
**Component:** `apps/backend` (auth), `apps/frontend` (pages)

## Problem

The authentication flow has no user registration path:

- **Backend:** No `POST /auth/register` endpoint. The login endpoint accepts any claimed identity without credential verification (see issue `05-auth-stub-tier-bypass.md`).
- **Frontend:** No signup page. The `src/routes/` folder has placeholders but no auth flow UI (login page, registration form, forgot-password, profile settings, etc.).
- **Session creation:** Today's login is stub-only — users do not create accounts; they claim identities on-demand.

### Consequences

1. **No account creation flow:** New users cannot sign up. The stub login only supports existing sessions.
2. **No frontend auth UI:** The dashboard has no login/logout pages, user profile page, or session management.
3. **No password management:** No password reset, change-password flows.
4. **All reads are anonymous:** Correct for free-tier discovery, but the account-bound features (watchlist, saved filters, preferences) have no real user association.

## Design Intent

**Intentional for Phase A.** The session + tier-enforcement infrastructure is complete (ADR-0005). The **user registration flow** is additive, deferred until real user onboarding begins (linked to issue `05-auth-stub-tier-bypass.md` and `auth-users-table`).

The stub login endpoint is exercisable end-to-end for development and demo purposes. Real registration is a future feature effort.

## Related Issues

- `.scratch/code-quality-audit/issues/05-auth-stub-tier-bypass.md` — the auth stub endpoint
- `.scratch/auth-users-table/issue.md` — the `users` Postgres table that registration will create into
- ADR-0005 (docs/adr/0005-self-hosted-auth-nestjs-session-tier-capability-seam.md) — session + tier architecture

## Roadmap

**Trigger:** Same as `auth-users-table` — when real user registration begins.

### Implementation Steps

#### Backend

1. **Create `POST /auth/register` endpoint** (`apps/backend/src/auth/auth.controller.ts`):
   ```typescript
   @Post('register')
   async register(
     @Body() body: RegisterRequestDto,
     @Res({ passthrough: true }) res: Response,
   ): Promise<SessionUser> {
     // Validate email format
     // Check email not already registered
     // Hash password (bcrypt/argon2)
     // Create User row
     // Create session
     // Set httpOnly cookie
     // Return SessionUser
   }
   ```

2. **Create `RegisterRequestDto`** (`apps/backend/src/auth/dto/register.dto.ts`):
   ```typescript
   export class RegisterRequestDto {
     @IsEmail()
     email!: string;

     @IsString()
     @MinLength(8)
     password!: string;

     @IsString()
     @IsOptional()
     displayName?: string;
   }
   ```

3. **Add password validation utilities** (lib for hashing/verification):
   - `hashPassword(password: string): Promise<string>` — bcrypt/argon2
   - `verifyPassword(password: string, hash: string): Promise<boolean>`

4. **Update `POST /auth/login`** to use the new password verification:
   ```typescript
   @Post('login')
   async login(
     @Body() body: LoginRequestDto,
     @Res({ passthrough: true }) res: Response,
   ): Promise<SessionUser> {
     // Look up user by email (if email provided)
     // Verify password hash
     // Create session
     // Set httpOnly cookie
     // Return SessionUser
   }
   ```

5. **Add registration tests** (backend):
   - Duplicate email rejected
   - Weak password rejected
   - Valid registration creates User + session
   - Registered user can log in

#### Frontend

1. **Create login page** (`src/routes/auth.login.tsx`):
   - Email + password fields
   - Submit → `POST /auth/login`
   - Redirect to dashboard on success
   - Show error messages on failure

2. **Create signup page** (`src/routes/auth.signup.tsx`):
   - Email + password + confirm-password fields
   - Submit → `POST /auth/register`
   - Auto-login or redirect to login on success
   - Show validation errors

3. **Add logout button** in the `<AppShell>`:
   - Call `POST /auth/logout`
   - Clear session state (QueryClient reset)
   - Redirect to login

4. **Add password-reset flow** (deferred to a later issue):
   - `POST /auth/request-reset` — send reset link via email
   - `GET /auth/reset/:token` — verification page
   - `POST /auth/reset/:token` — update password

5. **Update `<AppShell>` to show user menu:**
   - Logged-in state: user email + tier + logout button
   - Logged-out state: login/signup links

6. **Add route protection:**
   - Protect dashboard routes from unauthenticated access (or keep anonymous for free tier)
   - Update `src/lib/auth.ts` to check session before rendering protected content

#### Contracts

1. **Extend `packages/contracts/src/http/auth.ts`** if needed:
   - `RegisterRequestDto` Zod schema (optional if DTO validation is sufficient)
   - Error responses (duplicate email, weak password, etc.)

---

## Files Affected

**Backend:**
- `apps/backend/src/auth/auth.controller.ts` — add `/register` endpoint, update `/login`
- `apps/backend/src/auth/dto/register.dto.ts` — new file
- `apps/backend/src/auth/password.utils.ts` — new file (hashing/verification)
- `apps/backend/src/auth/auth.controller.spec.ts` — update tests

**Frontend:**
- `apps/frontend/src/routes/auth.login.tsx` — new file
- `apps/frontend/src/routes/auth.signup.tsx` — new file
- `apps/frontend/src/components/app-shell.tsx` — add user menu + logout
- `apps/frontend/src/lib/auth.ts` — add registration/logout helpers
- `apps/frontend/src/api/auth.ts` — update query options

**Contracts:**
- `packages/contracts/src/http/auth.ts` — extend if needed

**Dependencies:**
- `bcrypt` or `argon2` library (add to `apps/backend/package.json`)
- `@types/bcrypt` if using TypeScript

---
