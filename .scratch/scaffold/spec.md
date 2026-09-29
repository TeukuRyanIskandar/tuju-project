# Scaffold execution effort — Bursa Platform (Product A)

Status: ready-for-agent

## What this is

The **execution** effort that stands up the monorepo skeleton against the locked
architecture ADRs (0001–0011). The architecture wayfinder map
(`.scratch/architecture/map.md`) reached its destination — all decisions are made;
this effort *does the thing*. It is **not** a wayfinder map (no decisions to chart);
it is an ordered set of build tickets with blocking edges.

**Inputs (fixed, do not re-decide):** ADR-0001 … ADR-0011 under `docs/adr/`. Every
ticket references the ADR(s) it implements. If a ticket seems to require an
architecture decision, that's a signal the architecture map missed something — stop
and flag it, don't decide it here.

## Destination

A running `docker compose up` local environment where all four workspaces build,
the contract seam generates both TS + Python types with the drift gate green, and
each service's test harness runs (even if with placeholder tests). An executor can
then start implementing features. **Not** in scope: actual product features (TA/FA
logic, dashboard UI, doc analysis) — those are feature efforts after the skeleton.

## Verified tool pins (Sept 2026)

- **NestJS 11** (Express v5 default).
- **TanStack Start 1.x** (stable since v1.0, Sept 2025) via `@tanstack/create-start`
  (aka `create-start-app`), Vite build tool, SSR-capable but shipped as static SPA
  per ADR-0005.
- **Zod v4** — native JSON Schema conversion (`z.toJSONSchema()`); the old
  `zod-to-json-schema` lib is deprecated. Supersedes the toolchain *detail* in
  ADR-0008 (approach unchanged: Zod source → JSON Schema → Pydantic).
- **datamodel-code-generator** → Pydantic v2 (JSON Schema input).
- **pnpm + Turborepo** (ADR-0002) for the TS half; **uv** for the Python world.
- **LangGraph** (Python) for the AI module (ADR unchanged; version pinned at ticket time).

## Ticket order (blocking edges)

```
01 root workspace ──┬─> 02 contracts ──┬─> 03 backend ──┐
                    │                  ├─> 04 frontend  ├─> 06 compose ─> 07 CI + test harness
                    └─> 05 ai ─────────┘                │
                                                        │
   (03, 04, 05 all depend on 02; 06 depends on 03/04/05; 07 depends on 06)
```

## Scope guardrails

- Skeleton only: wiring, config, one health/smoke path per service, placeholder tests.
- No product/business logic.
- Every choice traces to an ADR; no new architecture decisions.
- Secrets: `.env.example` with fake values only (ADR-0009). No real secret committed.
