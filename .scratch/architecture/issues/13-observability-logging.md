# Decide: observability & logging strategy across the three services

Type: grilling
Status: resolved
Blocked by: (none)

## Question

Decide how the three services (NestJS backend, Python/LangGraph AI worker) plus the
BullMQ queue and infra (RDS, Redis, S3) emit, collect, and correlate logs/metrics —
enough that an operator can trace a request end-to-end and diagnose a failed job.

Key structural threads to pull:
- **correlationId** (ADR-0007): the per-request id that fans out across NestJS →
  BullMQ → Python. This is the natural correlation key for cross-service tracing —
  the strategy should thread it through every log line and span.
- **Job failure classes** (ADR-0007): transient vs terminal, retries, DLQ. Observing
  retry/backoff/DLQ behaviour is a first-class need.
- **Single-EC2 + compose** runtime (ADR-0006): logs from all containers land on one
  box; decide whether they stay local (compose/journald) or ship off-box.

Must settle:

- **Log format + transport**: structured (JSON) logging in both NestJS and Python;
  where logs aggregate (local files/journald vs CloudWatch vs a third-party sink),
  weighed against the lean single-EC2 launch and all-AWS posture.
- **correlationId propagation**: how it's carried NestJS→queue→Python and stamped on
  every log/span so a single request is traceable across the language boundary.
- **Metrics + health**: minimum metrics for launch (queue depth, job latency, failure
  rate, DLQ size, service health/liveness) and where they surface.
- **Tracing**: whether distributed tracing (e.g. OpenTelemetry) is in-scope for launch
  or deferred — and if deferred, that the correlationId logging leaves it a cheap
  additive step later.
- Retention + cost posture appropriate to warm-500 launch.

Output: an ADR recording the logging format/transport, correlationId propagation,
the launch metrics/health set, and the tracing decision (in or deferred).

## Notes

Graduated from the map's "Not yet specified" fog. On the architecture critical path
(an executor needs the logging contract to wire services consistently). Independent
of the other three graduated tickets. Consult `grilling` + `domain-modeling`.


## Answer

Resolved → **[ADR-0010](../../docs/adr/0010-observability-stdout-json-cloudwatch-deferred.md)**.

**Structured JSON to stdout; CloudWatch and tracing deferred as cheap additive steps.**

Settles the five "Must settle" items:

- **Log format + transport:** both NestJS and Python emit **structured JSON to
  stdout only**. Docker `json-file` driver captures on the box; read via
  `docker logs` / SSM. **No CloudWatch for v1** — logs are disposable-with-the-box
  (ADR-0006 posture; Postgres/RDS holds durable records). Invariant: **app owns log
  content (JSON), runtime owns transport (driver)** — so enabling CloudWatch later
  is swap `json-file → awslogs` + a Terraform log group + one line on the ADR-0009
  instance-role policy, **zero app-code change**.
- **`correlationId` propagation:** **mandatory field on the log schema, both
  services.** NestJS stamps from request + passes in `JobEnvelope` (already does,
  ADR-0007); Python pulls it off the envelope onto every log line. This is the
  cross-service stitch key; near-free now, expensive to retrofit.
- **Metrics + health (lean):** `/health` liveness endpoints on NestJS + Python
  worker (compose healthchecks now; ECS/ALB later); queue/job/DLQ metrics via
  **BullMQ introspection** surfaced through a lightweight **Bull Board** route.
  **No metrics backend** (Prometheus/CloudWatch-metrics/dashboards deferred).
- **Tracing:** **rejected for v1** (not merely deferred). A 3-known-hop path
  (NestJS→BullMQ→worker) gains little from a span waterfall over
  `correlationId`-correlated logs; the real failure modes (retry/backoff/DLQ, two
  failure classes) are queue-state + log events. OTel SDK + Collector + X-Ray is
  the additive path if a real latency mystery/higher hop-count appears, and the
  mandatory `correlationId` log field means it's not a re-instrument.
- **Retention + cost posture:** stdout on-box = zero AWS logging cost at
  warm-500; logs die with the disposable box (accepted); CloudWatch retention is
  set when the flip happens.

**No new fog.** All app-side design (JSON stdout, `correlationId` on every line,
health endpoints, Bull Board) is consumed by the later scaffold-execution effort;
the CloudWatch/OTel enablement is a documented additive step, not an open decision.
