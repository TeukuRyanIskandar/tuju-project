# Scaffold: apps/backend — NestJS 11 + JobBus + Redis/Postgres wiring + auth skeleton

Status: ready-for-agent
Blocked by: 02
Implements: ADR-0001, ADR-0003, ADR-0004, ADR-0005, ADR-0006, ADR-0010

## Task

Scaffold the NestJS app — the identity authority, sole Postgres writer, and job
producer.

- **NestJS 11** app in `apps/backend`, consuming `packages/contracts` TS types.
- **JobBus seam** (ADR-0001): a `JobBus` service wrapping **BullMQ** (Redis
  connection by env URL, ADR-0006); `enqueue`/subscribe signatures per ADR-0007. No
  real job logic — a stub job name that round-trips.
- **Data layer** (ADR-0004): TypeORM + Postgres (connection URL by env); one trivial
  entity + migration to prove the wiring; NestJS is the sole writer.
- **Auth skeleton** (ADR-0005): opaque server-side session in Redis behind
  httpOnly/Secure/SameSite cookie; a `TierGuard` + `@RequiresJob` decorator wired to
  a central tier→allowed-job-types map (stub map). Login/session endpoints can be
  stubs.
- **Health** (ADR-0010): `/health` liveness endpoint; **Bull Board** route for queue
  introspection.
- **Logging** (ADR-0010): structured JSON to stdout; `correlationId` as a mandatory
  field, stamped from request and passed into `JobEnvelope`.
- Config: all hosts/creds by env URL (ADR-0006 invariant), sourced from `.env` locally.
- **Tests** (ADR-0011): **Jest**; a unit test (e.g. TierGuard allow/deny with mocked
  session) + an integration test placeholder (marked to run against testcontainers at
  ticket 06/07).

## Done when

`pnpm --filter backend build` + `start:dev` boot; `/health` returns ok against a local
Redis+Postgres; enqueuing the stub job shows in Bull Board; Jest unit test passes.
