# Scaffold: docker-compose local stack (NestJS + Python + Redis + Postgres + LocalStack)

Status: done
Done in: 9b0957b
Blocked by: 03, 04, 05
Implements: ADR-0006

## Task

Wire the one-command local environment (ADR-0006): `docker compose up` brings up the
whole stack.

- `docker-compose.yml` (or `compose.yaml`) with services: **NestJS backend**,
  **Python AI worker**, **Redis** (AOF on, matching prod on-box Redis),
  **Postgres**, **LocalStack** (S3 emulator, supersedes MinIO per ADR-0006).
- Dockerfiles for backend and AI worker (frontend served as static build or dev
  server as appropriate).
- All inter-service config by **connection URL env vars** (ADR-0006 invariant) — no
  hardcoded hosts.
- LocalStack init to create the S3 bucket the AI artifact claim-check uses.
- Postgres init/migration run so the backend entity exists on boot.
- Verify the full round-trip: FE → backend enqueue → AI worker consumes → writes to
  LocalStack S3 → returns pointer → backend persists → FE can read via backend proxy.

## Done when

`docker compose up` boots all five services healthy; the end-to-end stub job
round-trip completes; `docker logs` shows structured JSON with a shared
`correlationId` stitched across backend + AI (ADR-0010).

## Notes

This is the local mirror of the prod stack (minus RDS/S3 externalisation). The same
containers repackage for the ADR-0006 scale ladder. LocalStack replaces MinIO.
