# Lean deployment: single EC2 + docker-compose on AWS, externalised RDS + S3

**Status:** accepted

## Context

Product A's runtime inventory (from prior ADRs): NestJS backend (long-running, sole Postgres writer, session authority), Python/LangGraph AI worker(s) (stateless queue consumers, ADR-0002/0003), Redis (BullMQ broker + session store + cache, ADR-0001/0004/0005), Postgres (system of record, ADR-0004), object storage (ADR-0004), and a static-SPA TanStack Start frontend (ADR-0005, a CDN artifact in prod). Constraints: lean launch to a warm ~500 (Malaysian/KLSE audience), funds a concern, fixed-price compute preferred (ADR-0005), and a clean scale path wanted. The user is most familiar with single-VPS + docker-compose and intends to use **Terraform + LocalStack** — i.e. AWS as the target cloud.

## Decision

### Prod runtime — single EC2 + docker-compose, all-AWS
- Compute runs as **docker-compose on a single EC2 instance**: NestJS + Python AI worker + a **Redis container** (kept on-box at launch).
- **Postgres externalised to RDS**; **object storage on S3** — the data that can't be lost lives in managed AWS services, off the disposable compute box. Redis stays on-box (rebuildable per ADR-0001: sessions re-login, cache re-warms, jobs idempotent).
- **All-AWS, one footprint** (avoids cross-provider egress and a split infra story), provisioned by **Terraform** (EC2 + RDS + S3 + networking/security groups).
- **Region: `ap-southeast-1` (Singapore)** — lowest latency for the Malaysian audience (~5–15 ms vs. ~200–250 ms from US). The modest premium over US is worth protecting the interactive dashboard/login feel for the launch audience; the async AI jobs are latency-insensitive, so the region choice is really about the snappy interactive surface. Cost lever if needed is caching/EOD-served tiles (ADR-0004), not moving region.

### Object storage local target — LocalStack (replaces MinIO)
- Local dev uses **LocalStack S3** as the S3 emulator (ADR-0004 named MinIO; superseded here by LocalStack to match the AWS SDK/endpoint everywhere and the chosen tooling). The S3-compatible adapter from ADR-0004 is unchanged; only the local endpoint differs.

### Local dev — one command, no cloud account
- **`docker compose up`** brings up NestJS + Python worker + Redis + **Postgres (container)** + **LocalStack (S3)**. A developer boots the whole system with zero AWS credentials. The FE runs as its dev server against these.

### Config / service discovery — connection-URL by env
- Every service reaches its dependencies by **connection URL / env var** (`DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT` + bucket), **never hardcoded hosts**. The *interface is identical across environments*; only the targets differ (local container/LocalStack vs. RDS/S3). This is the single tax that makes both externalising the data layer and the later orchestration migration nearly free.

## Consequences

### Scale ladder (recorded so scaling is a known path, not a surprise)
1. **Launch:** single EC2 + compose.
2. **First pinch = AI workers** (heavy/bursty). Respond by (a) **scaling worker replicas wide** on the same box (`--scale ai-worker=N`, zero code change — stateless BullMQ consumers), then (b) **scaling the box up** (bigger EC2, a one-line Terraform change).
3. **Outgrow one box → ECS/Fargate (or EKS)** + **Redis externalised to ElastiCache**. Because services are stateless and reach RDS/S3/Redis by URL, this is repackaging the same containers, not a rewrite (the `JobBus` seam + stateless design of ADRs 0001–0005 are what make it cheap).
- **Real ceilings are RDS and Redis, not the compute.** RDS scales up then out (read replicas); Redis moves to ElastiCache at the orchestration step.

### Accepted launch tradeoff
- **Single EC2 is a single point of failure.** A reboot = brief downtime; sessions survive (Redis container volume + AOF), in-flight jobs survive (AOF + idempotent re-run). HA arrives with the ECS/EKS step. This is a **deliberate lean-launch choice**, not an oversight.

### Notes
- Redis must run with **AOF persistence** on-box so a restart doesn't drop the queue/sessions.
- Postgres durability is RDS's responsibility (automated backups) — one of the reasons for externalising it.
