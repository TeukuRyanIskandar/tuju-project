# tuju-project

Bursa Malaysia intelligence platform — one web app, three products. Leading with
**Product A**: a one-stop dashboard with automated technical + fundamental analysis
and IPO/prospectus document analysis.

**Status:** the monorepo skeleton is complete (scaffold tickets 01–07): every
workspace builds, the contract seam generates TS + Python types behind a drift
gate, `docker compose up` runs the full stack, and CI is wired. On top of it:

- **Free-tier backend, specs 01–05 — shipped:** data ingestion + domain model
  (synthetic co-generation generator, dedicated ingestion worker, ADR-0012),
  search + stock page, screener, announcements / news / corporate events, and
  market overview (movers, indices, sectors).
- **Spec 06 AI showcase — in progress:** the system-triggered daily market brief
  and announcement summaries run end-to-end over the JobBus, but the narratives
  are deterministic templates (no real LLM yet). The prospectus parse + section
  router is built, and the prospectus at-a-glance job (`analyze-prospectus`) is
  wired end-to-end (`enqueue-prospectus` ops command → worker → `GET
  /ipo/:prospectusId/at-a-glance`).
- **Not yet:** the frontend is still a placeholder SPA, and auth login is a stub
  (ADR-0005).

This repository is a monorepo with a **deliberate two-world layout** (ADR-0002).

## The two worlds

```
tuju-project/
├── apps/
│   ├── frontend/     @tuju/frontend   TanStack Start 1.x static SPA  ─┐
│   └── backend/      @tuju/backend    NestJS 11 API + ingest worker   ├─ TS world:
├── packages/                                                          │  pnpm workspace
│   └── contracts/    @tuju/contracts  Zod v4 contract seam           ─┘  + Turborepo graph
│
├── services/
│   └── ai/           tuju-ai          Python BullMQ worker + LangGraph ── Python world:
│                                                                          uv-managed,
│                                                                          OUTSIDE pnpm/Turbo
├── infra/localstack/ local S3 bucket init
├── docs/adr/         architecture decision records (0001–0013)
├── .github/          CI workflows + composite setup actions
└── docker-compose.yml   local runtime
```

- **TS world** (`apps/*` + `packages/*`) is managed by **pnpm workspaces** and the
  **Turborepo** task graph.
- **Python world** (`services/ai`) is **uv-managed** and **deliberately excluded**
  from the pnpm workspace and the Turbo graph (ADR-0002). It has its own
  `pyproject.toml` and `uv.lock`.
- The two worlds communicate **only** through the Redis + BullMQ **JobBus**
  (ADR-0001) and the shared **contract seam** (`packages/contracts`, ADR-0007) —
  never via cross-language code imports. This keeps `services/ai` cleanly
  extractable to its own repo later.

## Contract seam

`packages/contracts` holds the job / result / progress schemas as Zod v4 source.
Generation emits TS types, JSON Schema, and Pydantic v2 models for `services/ai`:

```bash
pnpm --filter @tuju/contracts generate   # regenerate TS + JSON Schema + Pydantic
pnpm --filter @tuju/contracts check      # drift gate: fails if generated output is stale
```

Generation needs both worlds installed (the Pydantic step shells out to `uv`).

## Toolchain

- **Node** ≥ 24 (`.nvmrc` pins the exact version), **pnpm** ≥ 11 (`packageManager`
  field), **Turborepo** 2.x.
- **uv** for the Python world; Python pinned via `services/ai/.python-version`.
- **Docker** for the local stack and the integration tests (testcontainers).

## Getting started

```bash
# TS world
pnpm install                 # install workspace deps at root
pnpm build                   # turbo run build
pnpm test                    # turbo run test (unit + contract)
pnpm lint && pnpm typecheck

# Python world (its own commands, outside Turbo)
pnpm run ai:sync             # uv sync --project services/ai
pnpm run ai:test             # uv run --project services/ai pytest
```

Integration tests run against real Redis / Postgres / LocalStack via
testcontainers and need Docker running (ADR-0011). See
`.github/workflows/ci-integration.yml` for the exact commands.

## Local runtime

```bash
docker compose up --build
```

Brings up the whole stack with zero AWS credentials (ADR-0006):

| Service            | Port | Notes                                                              |
| ------------------ | ---- | ------------------------------------------------------------------ |
| `frontend`         | 8080 | static SPA served by nginx                                         |
| `backend`          | 3000 | NestJS API; runs migrations on boot; `/health`, Bull Board         |
| `ingestion-worker` | —    | headless NestJS (same image, `worker-main.ts`); owns all ingest crons (ADR-0012) |
| `ai-worker`        | —    | consumes the `analysis` queue; `--scale ai-worker=N`               |
| `redis`            | 6379 | BullMQ broker + sessions, AOF on                                   |
| `postgres`         | 5432 | system of record                                                   |
| `localstack`       | 4566 | S3 emulator for claim-check artifacts                              |

Every dependency is reached by a connection-URL env var, so the same containers
run in prod with only the targets changed.

## CI

GitHub Actions (ADR-0008 / ADR-0011):

- **PR** (`ci-pr.yml`) — lint, typecheck, build, unit + contract tests on both
  worlds, the contract drift gate, and a gitleaks secret scan. No images, no AWS.
- **Integration** (`ci-integration.yml`) — JobBus round-trips against real infra
  via testcontainers.
- **main** (`ci-main.yml`) — builds and pushes SHA-tagged images to ECR.
- **release** (`ci-release.yml`) — on `v*` tags: GitHub Release notes, ECR retag.

The ECR jobs are gated on the `ECR_DEPLOY_ENABLED` repository variable and stay
skipped until the AWS infra (ECR repos, OIDC role) is provisioned. Deploy is a
separate manual step; CI has no prod access.

## Secrets / environment

Copy `.env.example` (fake/local values only) to `.env` (gitignored) for local dev.
Real prod secrets come from AWS SSM Parameter Store via fetch-on-boot (ADR-0009);
no real secret is ever committed.

## Docs

- [`docs/adr/`](docs/adr/) — system-wide architecture decisions (0001–0013).
- [`CONTEXT-MAP.md`](CONTEXT-MAP.md) — indexes the per-context `CONTEXT.md` in each
  workspace member (domain vocabulary per context).
- [`docs/research/`](docs/research/) — research findings (e.g. Bursa market-data sources).
- `.scratch/` — local issue tracker (specs + tickets); see `docs/agents/issue-tracker.md`.
