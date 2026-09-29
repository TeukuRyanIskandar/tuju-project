# Context: Backend (`@tuju/backend`)

NestJS 11 service. Three roles (ADR-0001/0003/0004/0005/0006/0010):

- **Identity authority** — owns users, sessions, and an httpOnly session cookie.
- **Sole Postgres writer** — the only context that writes the relational store
  (TypeORM). The AI worker never writes Postgres (ADR-0004).
- **Job producer** — enqueues `JobEnvelope`s onto the Redis + BullMQ `analysis`
  queue (ADR-0001) and reads results back.

## Responsibility

- Authenticate requests and mint/verify the session cookie (`src/auth`).
- Enforce **tier → capability** at the enqueue seam (`tier.guard`, `tier-policy`,
  `requires-job.decorator`). Tier is re-checked here regardless of what the FE shows.
- Produce jobs and surface results (`src/jobbus`, `src/analysis`), with Bull-Board
  for queue inspection.
- Own the data layer: entities, migrations, `data-source.ts` (`src/data`).
- Expose `/health` (ADR-0010) and structured JSON logging with `correlationId`.

## Boundaries

- Talks to the AI world **only** through the JobBus + `@tuju/contracts` — never
  imports Python code (ADR-0002).
- Consumes `@tuju/contracts` TS types via `workspace:*`; does not redefine message shapes.

## Glossary

- **Tier** — the subscription level read from the session; drives capability checks.
- **Capability** — a permission question (e.g. `canRunJob`) derived from tier;
  code asks capabilities, not tier names.
- **Enqueue seam** — the guarded boundary where a request becomes a JobBus job.

## Commands

```bash
pnpm --filter backend start:dev   # watch mode
pnpm --filter backend test        # jest (unit)
pnpm --filter backend test:int    # jest integration (testcontainers)
pnpm --filter backend typecheck   # tsc --noEmit
pnpm --filter backend migration:run
```

## Decisions

System-wide ADRs in `docs/adr/` govern this context (esp. ADR-0001, 0003, 0004,
0005, 0006, 0010). No context-scoped ADRs yet.
