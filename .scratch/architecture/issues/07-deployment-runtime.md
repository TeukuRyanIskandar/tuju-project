# Decide: deployment & runtime shape (local + prod)

Type: grilling
Status: resolved
Blocked by: (none)

## Question

Decide how the three services (TanStack Start FE, NestJS BE, Python AI worker) plus the broker and DB run — locally and in production.

Must settle:

- **Local dev:** containerised (docker-compose bringing up FE, BE, AI, broker, DB)? How a developer boots the whole system with one command.
- **Prod runtime:** where each service runs (containers on a single host, a PaaS, k8s?) — keep it lean for a Product-A launch to a warm 500, not over-engineered.
- How the broker and DB are provisioned in each environment.
- Environment/config strategy at a high level (how services discover each other and read config).

<!-- Added by ADR-0004 (ticket 05): object storage (MinIO local / S3 or R2 prod) is now a required dependency alongside broker + DB — must be provisioned in each environment and reachable by both Python (write to results/*) and NestJS (read/lifecycle). -->
- **Object storage** (MinIO local / S3 or R2 prod): how it's provisioned per environment and how Python + NestJS reach it.

Output: an ADR recording the runtime shape + the one-command local-dev story the executor will implement.


## Answer

Recorded as [ADR-0006](../../../docs/adr/0006-deployment-single-ec2-compose-aws-rds-s3.md).

**Prod runtime — single EC2 + docker-compose, all-AWS.** Compute (NestJS + Python worker + **Redis container**) runs as docker-compose on one **EC2** instance; **Postgres externalised to RDS**, **object storage on S3** — the irreplaceable data lives in managed AWS off the disposable box, Redis stays on-box (rebuildable per ADR-0001). One AWS footprint (avoids cross-provider egress), **Terraform**-provisioned. **Region `ap-southeast-1` (Singapore)** — lowest latency for the Malaysian audience; the async AI jobs are latency-insensitive, so the region choice protects the *interactive* dashboard/login feel, worth the modest premium over US.

**Object storage local target — LocalStack replaces MinIO** (ADR-0004 named MinIO; superseded to match the AWS SDK/endpoint everywhere + the user's Terraform+LocalStack tooling). ADR-0004's S3-compatible adapter unchanged; only the local endpoint differs.

**Local dev — one command, no cloud account.** `docker compose up` brings up NestJS + Python worker + Redis + Postgres (container) + LocalStack (S3); FE runs its dev server against them.

**Config/discovery — connection-URL by env** (`DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`+bucket), never hardcoded hosts; identical interface across envs, only targets differ. This is the tax that makes both externalising the data layer *and* the later orchestration migration cheap.

**Scale ladder (recorded):** (1) launch = single EC2 + compose; (2) first pinch = AI workers → scale worker replicas wide on-box (`--scale ai-worker=N`, zero code change, stateless BullMQ consumers), then scale the box up (one-line Terraform); (3) outgrow one box → **ECS/Fargate or EKS + Redis to ElastiCache** — repackaging the same stateless containers, not a rewrite (the `JobBus` seam + stateless design of ADRs 0001–0005 enable it). **Real ceilings are RDS + Redis, not the compute.**

**Accepted launch tradeoff:** single EC2 = a single point of failure (reboot = brief downtime; sessions survive via Redis AOF volume, in-flight jobs survive via AOF + idempotent re-run). HA arrives with the ECS/EKS step — a deliberate lean-launch call. Redis runs with **AOF persistence** on-box.
