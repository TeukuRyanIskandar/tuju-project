# ADR-0010: Observability & logging — structured stdout JSON, CloudWatch & tracing deferred

- Status: Accepted
- Date: 2026-09-29
- Deciders: Bursa platform architecture effort (wayfinder map: Architecture Map — Bursa Platform (Product A))
- Context ticket: `.scratch/architecture/issues/13-observability-logging.md`
- Builds on: [ADR-0006](0006-deployment-single-ec2-compose-aws-rds-s3.md) (single EC2 + compose, all-AWS, disposable box, connection-URL-by-env), [ADR-0007](0007-job-result-progress-contract-bullmq.md) (`correlationId` fan-out key; two failure classes; retry/backoff/DLQ), [ADR-0009](0009-secrets-management-env-dev-ssm-prod-fetch-on-boot.md) (EC2 instance-role auth, no static creds)

## Context

The three services (NestJS backend, Python/LangGraph AI worker) plus the BullMQ
queue and infra (RDS, Redis, S3) need to emit, collect, and correlate logs and
metrics so an operator can trace a request end-to-end and diagnose a failed job.

The runtime is fixed by ADR-0006: everything runs as docker-compose on a single,
**deliberately disposable** EC2 in `ap-southeast-1`, all-AWS. ADR-0007 already
mints a per-request **`correlationId`** (a UUID that fans out across
NestJS → BullMQ → Python), which is the natural cross-service correlation key, and
defines the failure surface we must be able to observe: **two failure classes**
(transient-exhausted vs terminal) and **retry/backoff/DLQ** behaviour.

The launch target is a warm audience of ~500 early adopters, so the posture is
lean and cost-conscious, matching the rest of the map.

## Decision

### 1. Log transport — structured JSON to stdout, `json-file` driver, on-box for v1

Both NestJS and the Python worker emit **structured JSON to stdout only** — never
to files, never a hand-rolled text format. Docker's default `json-file` log driver
captures stdout on the box; operators read via `docker logs` / SSM Session Manager.

**No CloudWatch for v1.** Logs are treated as **disposable with the box**,
consistent with ADR-0006's disposable-EC2 posture: the irreplaceable data lives
off-box (RDS, S3), and Postgres (`analysis_results`, ADR-0007) is the durable
*record* of what happened. Logs are operational breadcrumbs, acceptable to lose on
a reboot/replace at warm-500 scale.

### 2. Invariant — app owns content, runtime owns transport

The application owns log **content** (structured JSON); the runtime owns log
**transport** (the Docker logging driver). App code is ignorant of where its
output goes. This is the same shape as ADR-0006's connection-URL-by-env tax, and
it is what makes CloudWatch a cheap additive step (see Consequences).

### 3. `correlationId` is a mandatory field on the log schema — both services

Every log line on both sides **must** carry the ADR-0007 `correlationId`:

- NestJS stamps it from the request and already passes it in the `JobEnvelope`.
- The Python worker pulls it off the envelope and stamps it on **every** log line
  it emits for that job.

This is the cross-service stitch key. It is near-free to add now and expensive to
retrofit, and it is precisely what makes a future CloudWatch Logs Insights query
like "show everything for `correlationId` X across both services" possible.

### 4. Metrics + health — lean, no metrics backend for v1

- **Health / liveness:** a plain `/health` endpoint on NestJS and on the Python
  worker. Compose healthchecks read them now; a future ECS/ALB (ADR-0006 scale
  ladder) consumes the same endpoints.
- **Queue / job / DLQ metrics:** sourced from **BullMQ's own introspection**
  (queue depth, active/failed/completed counts, DLQ size are BullMQ API calls),
  surfaced through a lightweight **Bull Board** admin route. Observing the
  ADR-0007 retry/backoff/DLQ behaviour and failure classes is served here.
- **No metrics backend** for v1 — Prometheus, CloudWatch custom metrics, and
  dashboards are all deferred to the same "later" bucket as CloudWatch Logs.

### 5. Distributed tracing — rejected for v1 (not merely deferred)

Distributed tracing / OpenTelemetry is **out of v1**. On a 3-known-hop path
(NestJS → BullMQ → one Python worker), a span waterfall buys little over
`correlationId`-correlated structured logs: there is no deep fan-out where the
thread is lost, and the failure modes we actually need to see (retry/backoff/DLQ,
the two failure classes) are queue-state and log events, not span-latency
problems.

If a real latency mystery or a higher hop count later justifies it, the additive
path is OTel SDKs + an OTel Collector container + AWS X-Ray (all-AWS via ADOT).
Because §3 makes `correlationId` a mandatory log field already, turning tracing on
is **not a re-instrumentation** — it is adding the tracer and a Collector.

## Consequences

**Positive**

- Zero new infra and zero AWS logging/metrics cost at launch — pure single-box,
  matches ADR-0006's lean posture.
- **CloudWatch is a config flip, not a rewrite:** swap the Docker log driver
  `json-file → awslogs` in the compose file, add a Terraform log group +
  retention, add one line to the ADR-0009 EC2 instance-role policy. **No
  application code changes**, because the app already emits JSON to stdout and
  stamps `correlationId`.
- The mandatory `correlationId` log field gives end-to-end request tracing across
  the language boundary today (via `docker logs` grep) and makes both CloudWatch
  Logs Insights and future OTel tracing cheap additive steps.
- Health endpoints and BullMQ introspection cover the launch metrics/health set
  with tools already in the stack.

**Negative / accepted risks**

- **Logs die with the box.** A reboot/replace loses log history; accepted at
  warm-500 (Postgres holds durable records; the box is disposable by ADR-0006).
  Mitigated the day it matters by turning on CloudWatch (above).
- **Diagnosing across services means SSM-in + `docker logs`** rather than a hosted
  query UI until CloudWatch is enabled. Accepted for a single box and a small
  operator group.
- **No historical metrics / alerting** in v1 (Bull Board is point-in-time). If an
  SLO or alerting need appears before scale, CloudWatch metrics/alarms is the
  additive step.

## Alternatives considered

- **CloudWatch Logs from day one (`awslogs` driver):** rejected for v1 as
  unnecessary cost/infra at warm-500; the app-side design (stdout JSON +
  `correlationId`) makes it a cheap later flip, so nothing is lost by waiting.
- **OpenTelemetry with tracing at launch (SDKs + Collector + X-Ray/third-party
  backend):** rejected — adds a trace-backend operational surface on a single box
  for little value over correlated logs on a 3-hop path; the driving need (a
  latency mystery / deep fan-out) does not exist at launch.
- **Metrics backend (Prometheus / CloudWatch custom metrics + dashboards) at
  launch:** rejected — health endpoints + BullMQ introspection cover the launch
  set without a new backend.
- **Logging to files on the box:** rejected — couples the app to transport, breaks
  the content/transport invariant, and makes the CloudWatch flip harder rather
  than free.
