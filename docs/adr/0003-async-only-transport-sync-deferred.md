# ADR-0003: Async-only transport (NestJS → AI) for v1; synchronous path deliberately deferred

- Status: Accepted
- Date: 2026-09-28
- Deciders: Bursa platform architecture effort (wayfinder map: Architecture Map — Bursa Platform (Product A))
- Context ticket: `.scratch/architecture/issues/04-nestjs-ai-contract.md`
- Builds on: [ADR-0001](0001-redis-bullmq-nestjs-python-jobbus.md) (Redis + BullMQ behind a `JobBus`)

## Context

ADR-0001 fixed the broker (Redis + BullMQ, behind a `JobBus` seam) for async
NestJS → Python/LangGraph work. It left open a topology question: is **every**
NestJS→AI interaction async over that queue, or does some class of AI work
warrant a **synchronous** request/response path (HTTP/gRPC) on the Python side
alongside the queue?

Facts from the deciding session that fixed the answer:

- **v1 does TA and FA only.** IPO/prospectus doc analysis is deferred; it is
  unambiguously async (minutes-long, nobody waits on-screen) and doesn't bear on
  the v1 topology choice beyond "must not be precluded."
- **TA/FA has two triggers:** (a) user-triggered ("analyze this stock"), and
  (b) **system-triggered by sudden price movements** — auto-generate an
  explanation of the move. The two triggers run the **same** underlying TA/FA
  pipeline.
- **Latency is unmeasured** — nothing is built yet — but TA/FA involves an LLM
  drafting an explanation, so sub-second is unlikely.
- The AI module has a **non-trivial failure profile** (LLM timeouts, rate
  limits, hanging tool calls, flaky upstream data, bad generations needing a
  retry).

## Decision

**Async-only over BullMQ for v1.** No synchronous NestJS→AI transport is built.

- **Both triggers enqueue the same TA/FA job.** The price-movement trigger is
  event-driven and inherently a background job (no user is waiting); the
  user-click trigger rides the *same* queue and job contract rather than a second
  transport.
- **The UI renders analysis as a streaming job**, subscribing to BullMQ progress
  events (ADR-0001: `updateProgress` → `QueueEvents.on('progress')`) to show live
  LangGraph steps ("computing indicators… fetching fundamentals… drafting
  explanation…") then fill in the result. For a "why did this move" AI answer,
  streaming progress is a better UX than a blocking wait.
- **A synchronous path is deliberately deferred**, not rejected. It is added
  later *only if* a measured, genuinely interactive **sub-second** AI surface
  appears in the product (none exists today). The boundary rule for revisiting:
  *if a new AI interaction needs a sub-second, user-blocking, single-shot answer
  where streaming-job UX would feel wrong, add a synchronous FastAPI route next
  to the worker — additively, without disturbing the queue contract or the
  `JobBus` seam.*

## Rationale

- **The queue is the failure-handling model, not just a latency tool.** For a
  component whose defining trait is "sometimes fails," BullMQ gives retry with
  backoff, dead-lettering, and idempotent re-runs for free (ADR-0001).
  A synchronous call has none of that — a failure is a raw 500 and any retry must
  be hand-built on both sides. Async is correct *because* the AI module fails,
  not despite it.
- **One computation, one transport.** Both triggers run the same pipeline;
  giving the user-click its own sync path would mean the same job over two wire
  formats with two failure models to maintain — a split-brain contract that
  fights the single-schema-seam discipline (ADR-0002, ticket 08).
- **Don't build what you can't yet see the need for.** Adding sync later is cheap
  and additive (the worker exists; expose one FastAPI route beside it).
  Building it speculatively — before any latency is measured — and discovering it
  was unnecessary is the expensive direction.

## Consequences

**Positive**

- Single transport and a single job contract for v1 (ticket 08 defines it once).
- Full resilience (retry/backoff/DLQ/idempotent re-run) on all AI work by
  default.
- Streaming progress UX aligns with LangGraph step reporting and the
  "explain this movement" feature.
- Doc analysis (later) and Product C's heavy jobs (a force) slot into the same
  async model without change.

**Negative / risks**

- If some TA/FA query turns out genuinely fast *and* demands an instant,
  blocking feel, users get streaming-job UX until a sync path is added later;
  accepted as low-likelihood and cheaply reversible via the deferral rule above.
- A future sync path introduces a second Python surface (FastAPI) to operate;
  scoped out of v1 precisely to avoid paying that cost early.

## Alternatives considered

- **Hybrid (build sync + async now):** rejected for v1 — no measured need, no
  interactive sub-second surface exists, and it doubles the contract/failure
  surface for the same pipeline. Kept available as an additive future step.
- **Sync-only:** never on the table — the price-movement trigger is inherently a
  background job and doc analysis is minutes-long.
