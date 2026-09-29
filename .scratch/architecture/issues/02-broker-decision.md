# Decide: which message broker / queue between NestJS and the AI module

Type: grilling
Status: resolved
Blocked by: 01

## Question

Given the research in ticket 01, decide the **specific broker/queue technology** for async NestJS ↔ Python (LangGraph) communication, and lock it as an ADR.

Must settle:

- The broker (e.g. RabbitMQ, Redis/BullMQ, NATS, …) and the concrete client libraries on each side.
- Whether the choice cleanly supports Python workers (no accidental JS-only lock-in like a BullMQ queue that Python can't consume).
- Whether it can express: job submission, progress/status, result return, retries, dead-lettering.
- That it won't preclude Product C's heavier-compute jobs later (a force, not a design task here).

Output: an ADR under `docs/adr/` recording the choice and the trade-off.


## Answer

**Decision: Redis + BullMQ**, native bindings on both sides (`@nestjs/bullmq` producer + official `bullmq` Python worker over shared Redis), wrapped behind a thin `JobBus` abstraction on each side. Locked as [ADR-0001](../../../docs/adr/0001-redis-bullmq-nestjs-python-jobbus.md).

Deciding inputs from the HITL session:
1. **Delivery guarantees are not contractual** — analysis jobs (TA/FA, doc analysis) are idempotent and re-runnable, so BullMQ's at-least-once worst case is acceptable.
2. **Redis is acceptable in the stack**, introduced as needed (also usable for cache/sessions), so BullMQ adds no unwelcome ops surface.
3. **Native BullMQ bindings on both sides** rather than a hand-rolled raw contract — this is the interop path that makes BullMQ win.

Guardrails: pin versions + early smoke test of submit→progress→result→retry (Python bindings are a younger project than the Node lib); **avoid BullMQ Flows** as a hard dependency (most likely JS↔Python parity gap); `JobBus` seam keeps a later migration to RabbitMQ + raw AMQP contained.

Supports the required semantics: job submission (`enqueue`), progress (`updateProgress` → `QueueEvents.on('progress')`, maps to streaming LangGraph step updates), result return (`job.returnvalue` / results queue), retries with backoff, dead-lettering. Python worker interops cleanly via first-party bindings — no JS-only lock-in. Doesn't preclude Product C's heavier jobs.

Fallback documented in the ADR: **RabbitMQ (plain AMQP + raw JSON)** if delivery guarantees ever become contractual — the `JobBus` seam is designed for exactly this swap.

Follow-on (graduated into the map's fog / new ticket): the concrete **job/result/progress contract** now that the broker is fixed; Redis persistence config folds into the deployment/runtime decision.
