# Self-hosted auth in NestJS + capability-shaped tier authorization

**Status:** accepted

## Context

Product A needs authentication and free/paid subscription-tier gating (free = dashboard; paid = auto TA/FA + doc analysis). Constraints in play: NestJS is the API owner and sole Postgres writer, Python is stateless (ADR-0004); TanStack Start FE is a separate app (ADR-0002); paid features are exactly the actions that enqueue BullMQ jobs (ADR-0003); early-stage funds are a concern; Products B (public/SEO surface) and C (premium tier) must not be precluded.

## Decision

### Authentication — self-hosted in NestJS
- **Self-hosted** (no auth provider). NestJS is the **identity + session authority**: owns the users table, hashes passwords, verifies credentials, owns tier state.
- **Opaque server-side session stored in Redis** (already in the stack), referenced by an **httpOnly, Secure, SameSite cookie** set by NestJS. Token never touches client JS; revocation is instant (delete the Redis session) — needed for tier downgrades/bans. Chosen over a stateless JWT specifically for revocability.
- Implemented with `@nestjs/passport` (session/cookie strategy) + a global `AuthGuard` that resolves `req.user` (incl. `tier`).

### Frontend shape — static SPA, no BFF (for Product A)
- **TanStack Start ships as a static SPA** (CDN); the browser talks to NestJS directly. No FE server on Product A's request path — cheapest, predictable cost.
- **BFF/SSR is deliberately deferred, not killed.** SSR/SEO is a Product B need (out of scope here). A later migration to a TanStack Start BFF is kept a cheap **additive** change by paying a small "keep-it-migratable" tax now:
  1. opaque Redis session (not a JWT baked into the FE),
  2. cookie on a **shared parent domain** a proxy can later assume,
  3. FE uses a single **configurable API base**, not hard-coded URLs.
- Fixed-price long-running compute is *preferred* (avoid per-invocation serverless, which compounds under proxying) — recorded as a preference for ticket 07, not a hard constraint.

### Authorization — centralized, capability-shaped tier gating
The durable commitment is **two invariants**, deliberately more important than today's tier implementation:
1. **All authorization flows through one central seam** — the job-enqueue boundary — via a single `can(user, action)`-shaped check.
2. **Call sites ask capability questions, never tier names** (`can(user, 'run_doc_analysis')`, never `if (tier === 'pro')`).

Today's implementation of `can()`:
- **Data model:** a single ordinal `tier` field on the user (`free` / `pro`; `premium` reserved for Product C). Not a boolean (can't grow past two levels); not an entitlements table (over-built for launch).
- **Policy:** one central **tier → allowed-job-types map** as the single source of truth (`free → []`, `pro → [ta, fa, doc_analysis]`, `premium → [...pro, deep_doc_analysis]`).
- **Mechanism (NestJS-native):** a `TierGuard` (`CanActivate`) + a `@RequiresJob(...)` decorator read via `Reflector` on user-facing routes (idiomatic NestJS RBAC), **plus** a service-level check inside `JobBus.enqueue` for defense-in-depth.
- **Location:** the job-enqueue seam — "paid feature" ≡ "enqueues a job", so one boundary can't forget a guard.
- **System-triggered jobs** (price-move trigger, ADR-0003) have no `req.user`; they are a **trusted internal caller** that bypasses tier. The route guard covers user requests; the enqueue-level check covers this path.
- **FE role:** reads `tier` from the session/`/me` response to show/hide paywalled UI — **presentation only**; NestJS always re-checks at enqueue.

### Product B / C seam
- **Product B** public surface = the **anonymous path** (no session required).
- **Product C** premium tier = a **map edit** (add `premium` + its job types), no enqueue-site changes.

## Consequences
- **Handles permission creep by design, not prediction.** More tiers = map edit. Per-user grants/add-ons/comps/trials = swap the map lookup for an entitlements lookup *behind the same `can()`* — call sites unchanged.
- **New authorization *dimensions* (orgs/team seats, per-resource row-level sharing) will need a real policy layer** — the pre-identified escape hatch is **CASL** (NestJS-supported) behind the same `can()` seam. This is a deliberate future redesign of the policy layer only, isolated by the centralized seam; not built now (would be over-engineering for a two-tier launch).

## Scope
- **Out of scope for this decision:** per-resource / row-level ownership authz ("can this user read *this specific* result?") — a data-ownership concern, decided with data/result-access design, not tier gating. Also out of scope: pricing, payment-provider integration, full billing lifecycle.
