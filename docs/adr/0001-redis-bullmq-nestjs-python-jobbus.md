# ADR-0001: Redis + BullMQ as the NestJS ↔ Python job broker, behind a JobBus abstraction

- Status: Accepted
- Date: 2026-09-28
- Deciders: Bursa platform architecture effort (wayfinder map: Architecture Map — Bursa Platform (Product A))
- Context ticket: `.scratch/architecture/issues/02-broker-decision.md`
- Feeding research: `.scratch/architecture/issues/01-broker-research.md`

## Context

Product A dispatches long-running AI jobs (automated TA/FA, IPO/prospectus doc
analysis) from the **NestJS** backend to a **Python + LangGraph** worker. The
stack already fixes the transport as async **queue/messaging**; the *specific*
broker was left open.

The job semantics we need: submit a job, report progress back to the UI, return
a result, retry on failure, and dead-letter on repeated failure. The seam must
support a **Python** worker cleanly — no accidental JS-only lock-in — and must
not preclude Product C's heavier-compute jobs later (a force, not a design task
here).

The research (ticket 01) compared RabbitMQ, Redis+BullMQ, NATS/JetStream, and
Kafka. Key findings:

- **BullMQ has official first-party Python bindings** (`pip install bullmq`),
  so a JS-produced queue interoperates cleanly with a Python worker over shared
  Redis — it does **not** force a JS-only consumer.
- BullMQ provides native progress (`job.updateProgress` →
  `QueueEvents.on('progress')`), retries with backoff, delayed/prioritized jobs,
  stalled-job recovery, and result hand-off (`job.returnvalue` / a results
  queue) out of the box.
- RabbitMQ offers the strongest durability and native dead-lettering, but the
  NestJS RMQ transporter wraps payloads in its own envelope, so clean Python
  interop means treating it as plain AMQP + a hand-rolled JSON contract.
- NATS/JetStream and Kafka are the wrong shape / overkill for a Product-A-sized
  workload (~500 users, a few long jobs).

Decision inputs from the deciding session:

1. **Delivery guarantees are not contractual.** AI analysis jobs are idempotent
   and re-runnable; losing one occasionally and retrying is acceptable. BullMQ's
   at-least-once worst case is fine.
2. **Redis is acceptable in the stack** and can be introduced as needed (also
   usable for cache/sessions), so BullMQ adds no ops surface we're unwilling to
   take on.
3. **We adopt the native BullMQ bindings on both sides** rather than hand-rolling
   a raw contract.

## Decision

Use **Redis + BullMQ** as the job broker between NestJS and the Python/LangGraph
worker:

- **Producer (NestJS):** `@nestjs/bullmq` enqueues jobs and consumes
  progress/result events via `QueueEvents`.
- **Worker (Python):** the official `bullmq` package (`Queue` / `Worker`,
  asyncio) consumes jobs from the same Redis instance, reports progress via
  `updateProgress`, and returns results via `job.returnvalue` (and/or a
  dedicated results queue).
- **Both sides speak native BullMQ** over a shared Redis instance — this is the
  interop path that makes BullMQ win, so we take it deliberately rather than
  reducing Redis to a dumb pipe.

Guardrails that make the choice safe and reversible:

- **Wrap the queue behind a thin `JobBus` abstraction on each side.** App code
  talks to `JobBus` (NestJS: `enqueue(job)` / `onResult()` / `onProgress()`;
  Python: `consume(handler)` / `reportProgress()`), never to BullMQ directly.
  This contains a future migration (e.g. to RabbitMQ + raw AMQP) to the
  implementation layer.
- **Pin versions on both sides** and run an early smoke test of the core loop
  (submit → progress → result → retry) before building deep, because the Python
  `bullmq` bindings are a younger, separate project from the Node library.
- **Do not depend on BullMQ Flows** (parent/child job trees) as a hard
  requirement — that feature is the most likely to have a JS↔Python parity gap.
  Revisit only if Product C's orchestration needs it later.

## Consequences

**Positive**

- Lowest operational surface: a single Redis service, likely reused for
  cache/sessions.
- Batteries-included job semantics — native progress maps directly onto
  streaming LangGraph step updates to the UI; retries, backoff, delayed jobs,
  and stalled-job recovery come for free.
- Clean, first-party JS↔Python interop with no language lock-in.
- The `JobBus` seam keeps the decision reversible.

**Negative / risks**

- Durability is weaker than RabbitMQ by default; mitigated by idempotent,
  re-runnable jobs, a results queue for robust hand-off, and Redis persistence
  (AOF `everysec` + persistent disk in prod).
- The Python `bullmq` bindings can lag the Node library on advanced features;
  mitigated by pinning versions, the early smoke test, and avoiding Flows.
- BullMQ client must be used on **both** sides with aligned major versions
  (don't mix with hand-rolled Redis Streams).

**Follow-on work (feeds "Not yet specified" on the map)**

- The concrete job/result/progress **contract** (envelope shape, job types,
  progress schema) now that the broker is fixed.
- Redis persistence + deployment config as part of the deployment/runtime
  decision.

## Alternatives considered

- **RabbitMQ (plain AMQP + raw JSON):** strongest durability and native
  dead-lettering; chosen against because delivery guarantees are not contractual
  here and it costs a hand-rolled contract and an extra stateful service without
  a matching benefit at this scale. Remains the recommended fallback if delivery
  guarantees ever become contractual — the `JobBus` seam is designed for exactly
  this swap.
- **NATS / JetStream:** thinner job-queue semantics; wrong shape for a few long
  jobs.
- **Kafka / Redpanda:** event streaming, not request/response job dispatch;
  overkill at this scale.
