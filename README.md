# tuju-project

Bursa Malaysia intelligence platform — one web app, three products. Leading with
**Product A**: a one-stop dashboard with automated technical + fundamental analysis
and IPO/prospectus document analysis.

This repository is a monorepo with a **deliberate two-world layout** (ADR-0002).

## The two worlds

```
tuju-project/
├── apps/
│   ├── frontend/     @tuju/frontend   TanStack Start (ticket 04)   ─┐
│   └── backend/      @tuju/backend    NestJS         (ticket 03)    ├─ TS world:
├── packages/                                                        │  pnpm workspace
│   └── contracts/    @tuju/contracts  shared schema seam (ticket 02)┘  + Turborepo graph
│
├── services/
│   └── ai/           tuju-ai          Python + LangGraph (ticket 05) ── Python world:
│                                                                        uv-managed,
│                                                                        OUTSIDE pnpm/Turbo
├── docs/adr/         architecture decision records (0001–0011)
└── docker-compose.yml   local runtime (ticket 06 — stub for now)
```

- **TS world** (`apps/*` + `packages/*`) is managed by **pnpm workspaces** and the
  **Turborepo** task graph. `pnpm-workspace.yaml` lists `apps/*` and `packages/*`.
- **Python world** (`services/ai`) is **uv-managed** and **deliberately excluded**
  from the pnpm workspace and the Turbo graph (ADR-0002). It is `tuju-ai`, a
  self-owned environment with its own `pyproject.toml` and lockfile.
- The two worlds communicate **only** through the Redis + BullMQ **JobBus**
  (ADR-0001) and the shared **contract seam** (`packages/contracts`, ADR-0007) —
  never via cross-language code imports. This keeps `services/ai` cleanly
  extractable to its own repo later.

## Toolchain

- **Node** ≥ 24 (`.nvmrc` pins the exact version), **pnpm** ≥ 11 (`packageManager`
  field), **Turborepo** 2.x.
- **uv** for the Python world; Python pinned via `services/ai/.python-version`.

## Getting started

```bash
# TS world
pnpm install          # install workspace deps at root
turbo run build       # run the Turbo build graph (no-op until services fill in)
turbo run test        # test / lint / typecheck likewise

# Python world (its own commands, outside Turbo)
uv sync --project services/ai        # or: pnpm run ai:sync
uv run --project services/ai pytest  # or: pnpm run ai:test
```

## Local runtime

`docker compose up` will bring up frontend, backend, ai, redis, and db for local
development. **Stub for now** — the compose file is authored in scaffold ticket 06.

## Secrets / environment

Copy `.env.example` (fake/local values only) to `.env` (gitignored) for local dev.
Real prod secrets come from AWS SSM Parameter Store via fetch-on-boot (ADR-0009);
no real secret is ever committed.

## Architecture

All decisions are recorded as ADRs under [`docs/adr/`](docs/adr/) (0001–0011).
This skeleton implements **ADR-0002** (monorepo layout).
