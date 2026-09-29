# Decide: auth & subscription-tier enforcement

Type: grilling
Status: resolved
Blocked by: (none)

## Question

Decide how authentication and free/paid **subscription-tier** gating work for Product A. Lightweight — *where* tiering lives, not the full billing design.

Must settle:

- **Auth approach** (session vs. JWT; self-hosted vs. a provider) and where it lives (NestJS BE, an auth service, TanStack Start server layer?).
- **Where tier gating is enforced** — free tier (dashboard) vs. paid tier (auto TA/FA + doc analysis). Enforced at the API boundary, per-feature, per-route?
- How the FE knows the user's tier to show/hide paywalled features.
- A seam so Product C's premium tier and Product B's public (unauthenticated) surface slot in later.

Explicitly out of scope: pricing, payment-provider integration details, full billing lifecycle.

Output: an ADR recording the auth + tier-enforcement approach.


## Answer

Recorded as [ADR-0005](../../../docs/adr/0005-self-hosted-auth-nestjs-session-tier-capability-seam.md).

**Authentication — self-hosted in NestJS.** No auth provider (self-host was the user's lean-launch lean). NestJS is the identity + session authority (owns users table, hashes passwords, owns tier). **Opaque server-side session in Redis**, referenced by an **httpOnly/Secure/SameSite cookie** set by NestJS — chosen over stateless JWT for instant revocation (tier downgrades/bans). `@nestjs/passport` session strategy + global `AuthGuard` resolving `req.user`.

**Frontend — static SPA, no BFF for Product A.** Browser talks to NestJS directly; FE is a CDN artifact (cheapest, predictable). The user hesitated toward SSR/BFF, but SSR/SEO is a **Product B** need (out of scope) and funds are an early constraint. Resolved: **BFF/SSR deferred but kept a cheap additive migration** via three now-taxes — opaque Redis session, shared-parent-domain cookie, configurable API base. Confirmed a BFF gives Product A no meaningful UX win (authed dashboard) and only marginal security beyond an httpOnly cookie. Fixed-price compute recorded as a *preference* (not hard constraint) for ticket 07.

**Authorization — centralized, capability-shaped tier gating.** The durable commitment is two invariants: (1) all authz flows through **one seam** (the job-enqueue boundary) via a single `can(user, action)` check; (2) call sites ask **capability questions, never tier names**. Today's `can()` implementation: single ordinal `tier` field (`free`/`pro`, `premium` reserved for C) → a central **tier→allowed-job-types map** (the policy). Enforced with NestJS-native `TierGuard` (`CanActivate`) + `@RequiresJob(...)` decorator via `Reflector` on user routes, **plus** a service-level check in `JobBus.enqueue` for defense-in-depth. Enqueue seam chosen because "paid feature" ≡ "enqueues a job" (ADR-0003). **System-triggered price-move jobs** (no `req.user`) are a trusted internal caller that bypasses tier. FE reads `tier` for show/hide only — presentation, never enforcement.

**Permission-creep durability (user's explicit concern).** Handled by design, not prediction: more tiers = map edit; per-user grants/add-ons/comps/trials = swap the map lookup for an entitlements lookup *behind the same `can()`*, call sites unchanged. New *dimensions* (org/team seats, per-resource row-level sharing) will need a real policy layer — pre-identified escape hatch is **CASL** (NestJS-supported) behind the same seam; a deliberate future redesign of the policy layer only, not built now. User: "we'll deal with the problems if they arise."

**Seams:** Product B public surface = the anonymous path; Product C premium = a map edit.

**Scoped out:** per-resource/row-level ownership authz (belongs with data/result-access design); pricing/payment/billing lifecycle.
