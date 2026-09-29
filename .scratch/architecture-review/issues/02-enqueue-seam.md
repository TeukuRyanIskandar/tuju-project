# Make the Enqueue seam own the enqueue

Status: needs-triage
Strength: Strong
Dependency category: in-process (unit-testable with a fake queue)
Implements: ADR-0005 (defense-in-depth check at the enqueue seam), ADR-0007 §3
Related: 01 (correlation registration), 03 (jobId minted here only)

## Files

- `apps/backend/src/analysis/analysis.controller.ts`: `enqueue()` hand-builds the `JobEnvelope`
- `apps/backend/src/jobbus/job-bus.service.ts`: `enqueue()`, `deriveJobId()`
- `apps/backend/src/auth/tier-policy.ts`: `can()`
- `apps/backend/src/auth/tier.guard.ts`, `requires-job.decorator.ts`

## Problem

The caller-side interface is as large as the implementation. Every caller of
`JobBus.enqueue` has to know how to build a correct envelope: mint the
correlationId, stamp `asOf`, set `requestedBy` and `trigger`, and validate the
payload. The controller does all of this by hand, with `requestedBy: 'compose-smoke'`
hardcoded, and it casts `body.timeframe` unvalidated.

ADR-0005's second tier check (the service-level check inside `JobBus.enqueue`)
**doesn't exist**. `can()` has one production caller, `tier.guard.ts`. Anything that
reaches enqueue without the route guard enqueues without a check: the planned
price-move trigger, or a new route that forgets `@RequiresJob`. The comment in
`tier.guard.ts` describes the missing check as if it exists.

## Deletion test

Delete the controller's envelope-building and it reappears in every future
producer (price-move trigger, retries, doc analysis). The knowledge belongs at the
enqueue seam.

## Direction (not an interface design)

Callers hand the enqueue seam an **actor** (a user, or the trusted system caller
from ADR-0005) plus the job request. The module owns:

- `can(actor, jobName)`; the system caller bypasses the tier check per ADR-0005
- payload validation against the Zod contract
- envelope minting (correlationId, `asOf`, `requestedBy` from the actor, `trigger`)
- jobId derivation (see 03)
- queue policy (attempts, backoff, retention; currently inline literals)
- correlation registration (see 01)

The controller shrinks to HTTP translation. `TierGuard` stays as the route layer.

## Tests

- Unit tests: enqueue by an unentitled actor throws before `queue.add`; the system
  actor bypasses the check; an invalid payload is rejected; the envelope fields are
  derived correctly.
- The existing tier-policy and tier.guard specs stay.

## Open questions for grilling

- How is the actor represented (session user type vs a union type with a `system` value)?
- Should correlationId still reuse pino's `req.id` (ADR-0010), or be minted by the seam and logged?
- ADR-0007 says `backoff 5s → 15s → 30s`, but the code uses `fixed 5000`. Resolve here?

## Comments
