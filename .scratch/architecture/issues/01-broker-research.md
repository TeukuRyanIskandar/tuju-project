# Research: message broker options for NestJS ↔ Python job semantics

Type: research
Status: resolved
Blocked by: (none)

## Question

Gather the facts a broker decision waits on. Compare the realistic message-broker / queue options for **async communication between a NestJS backend and a Python (LangGraph) AI worker**, specifically for **job semantics** (submit a long-running TA/FA or IPO/prospectus doc-analysis job, track progress, return a result), not just fire-and-forget events.

Cover at least:

- **RabbitMQ** — NestJS first-class support via `@nestjs/microservices` (AMQP transport); Python via `aio-pika` / `celery` / `faststream`. Job/RPC patterns, ack/retry, dead-letter, delayed messages.
- **Redis** (as broker — Streams / lists, or via BullMQ) — simplicity vs. durability; NestJS `@nestjs/bullmq`; Python interop (does a JS BullMQ queue interop cleanly with a Python worker, or does that force a language split?).
- **Alternatives worth a mention:** NATS / NATS JetStream, Kafka/Redpanda — and why they're likely overkill for a Product-A-sized workload.

For each, capture: operational complexity (local dev + prod), durability/reliability guarantees, native NestJS support, native Python support, how result-return + progress-reporting is expressed, and cross-language interop gotchas.

Output a concise comparison the decision ticket can chew on, plus a tentative recommendation with rationale.


## Answer

### Message Broker / Queue Options: NestJS ↔ Python (LangGraph) Job Semantics

**Scope:** Submit long-running AI jobs (TA/FA, IPO prospectus doc analysis) from NestJS to a Python/LangGraph worker, track progress, return results. Target: ~500 users, lean polyglot stack.

#### 1. RabbitMQ (AMQP)
- **Ops:** Moderate — one extra stateful service; excellent management UI.
- **Durability:** Strongest — durable queues + persistent messages, manual ack/nack, prefetch, native dead-letter exchanges, TTL, delayed messages. Best for "job must not be lost / must retry".
- **NestJS:** First-class via `@nestjs/microservices` RMQ transport. `@MessagePattern` (RPC) / `@EventPattern` (fire-and-forget); `noAck: false` + `RmqContext` for manual ack.
- **Python:** Excellent — aio-pika (async AMQP), FastStream (modern, native RPC via Direct Reply-To), Celery (Python-first, avoid for interop).
- **Result/progress:** RPC via correlation-ID reply queue; for long jobs prefer publishing progress + result to a results/progress queue the backend consumes.
- **Interop gotcha (the big one):** NestJS's RMQ transporter wraps payloads in its own envelope `{ pattern, data, id }`. A raw Python consumer won't work with `@MessagePattern` unless it reproduces that envelope. **Cleaner:** treat RabbitMQ as a plain AMQP broker — raw JSON contract on both sides (custom NestJS serializer or plain `amqplib`; Python via aio-pika/FastStream). Avoid Celery as the interop seam (Python-centric protocol, pickle risk).

#### 2. Redis + BullMQ
- **Ops:** Lowest — likely already running Redis for cache/sessions; single container locally.
- **Durability:** Weaker by default (RDB/AOF); BullMQ adds atomic Lua scripts, stalled-job recovery, retries w/ backoff, delayed/prioritized jobs. BullMQ guarantee = at-least-once worst case — acceptable for idempotent, re-runnable AI jobs. Use AOF `everysec` + persistent disk in prod.
- **NestJS:** First-class via `@nestjs/bullmq`.
- **Python — CRITICAL FINDING:** **BullMQ has official first-party Python bindings** (`pip install bullmq`, asyncio). Same Queue/Worker classes, same Redis keys, same job format. **A JS-produced queue interoperates cleanly with a Python worker — it does NOT force a JS-only consumer.** (Bindings newer than Node core; pin versions, verify parity for advanced features like Flows.)
- **Result/progress:** Results via `job.returnvalue` + `QueueEvents.on('completed')` (or a dedicated results queue for robust hand-off). **Progress via native `job.updateProgress(n)`** → `QueueEvents.on('progress')` — maps directly onto streaming LangGraph step updates to the UI.
- **Interop gotcha:** Must use the BullMQ client on BOTH sides (don't mix with hand-rolled Redis Streams). Keep major versions aligned.

#### 3. Alternatives
- **NATS/JetStream:** Lightweight, low ops; but JetStream job-queue semantics (retries/DLQ/progress/dashboards) thinner than BullMQ/RabbitMQ. Wrong shape / overkill for a few long jobs at 500 users.
- **Kafka/Redpanda:** Event streaming, not request/response job dispatch. No native per-message ack/RPC. Clearly overkill at this scale.

#### At a glance
| Dimension | RabbitMQ | Redis+BullMQ | NATS/JetStream | Kafka |
|---|---|---|---|---|
| Ops (dev→prod) | Moderate | **Lowest** | Low–mod | High |
| Durability | **Strongest** | Good (config) | Good | Strong |
| NestJS | First-class | First-class | Transport | Transport |
| Python | aio-pika/FastStream | **Official bullmq** | nats-py | aiokafka |
| Progress | custom queue | **native updateProgress** | custom | manual |
| Interop gotcha | NestJS envelope → raw AMQP | BullMQ client both sides | JetStream semantics | not job-shaped |

#### Tentative recommendation
**Start with Redis + BullMQ** (NestJS `@nestjs/bullmq` producer + Python/LangGraph `Worker` via official `bullmq` bindings over shared Redis). Rationale: lowest ops surface, interop question resolves in its favor (first-party bindings), batteries-included job semantics incl. native progress, ample scale headroom (idempotent jobs mitigate durability gaps; use a results queue). **Choose RabbitMQ instead if** delivery guarantees are contractual, rich routing/DLQ needed, or the Python worker uses FastStream/aio-pika anyway (treat as plain AMQP + raw JSON). Wrap the queue behind a small `JobBus` abstraction on both sides so migrating later stays contained. **Skip NATS/Kafka** for Product A.

#### Sources
- BullMQ docs (semantics, Python bindings, returning job data): https://docs.bullmq.io/ , https://docs.bullmq.io/python/introduction , https://docs.bullmq.io/guide/returning-job-data
- NestJS microservices (RabbitMQ, basics): https://docs.nestjs.com/microservices/rabbitmq , https://docs.nestjs.com/microservices/basics
- FastStream RPC over RMQ: https://faststream.ag2.ai/latest/rabbit/rpc/
- Celery protocol: https://docs.celeryq.dev/en/stable/internals/protocol.html
- aio-pika: https://aio-pika.readthedocs.io/
