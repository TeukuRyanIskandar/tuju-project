# ADR-0002: Monorepo layout — pnpm + Turborepo for TS, Python (uv) as its own world

- Status: Accepted
- Date: 2026-09-28
- Deciders: Bursa platform architecture effort (wayfinder map: Architecture Map — Bursa Platform (Product A))
- Context ticket: `.scratch/architecture/issues/03-monorepo-layout.md`
- Related: ADR-0001 (Redis + BullMQ JobBus) — the runtime scalability and the cross-language contract seam both trace back to it.

## Context

The stack is fixed: **TanStack Start** frontend, **NestJS** backend, **Python +
LangGraph** AI worker, all in one **monorepo**. This decision settles the
tooling and folder layout so an executor can scaffold it with nothing left to
decide.

Two languages must coexist. The JS/TS half wants workspace linking + a task
graph; the Python half wants to own its own environment and lockfile. The main
open forks were: (1) the JS package manager, (2) the JS task runner, (3) the
JS runtime, (4) how Python fits relative to the JS task graph, and (5) the
concrete folder tree + naming.

Decision inputs from the HITL session:

1. **Runtime is Node, not Bun.** NestJS is the anchor: it officially targets
   Node and leans on `reflect-metadata` + `emitDecoratorMetadata` decorator DI,
   which is exactly the historically brittle area under Bun's Node-compat, and
   NestJS does not officially support Bun. TanStack Start and the committed
   BullMQ interop smoke test are also Node-validated first. Running a
   revenue-bearing backend on an officially-unsupported runtime is real risk for
   little gain — Bun's appeal collapses to "faster installs" once Node is forced,
   which pnpm already covers.
2. **Python is its own world.** Turborepo's task graph only understands packages
   with a `package.json`. Rather than give the Python dir a fake `package.json`
   shim to pull it into the graph, we keep Python honest: `uv`-managed, excluded
   from the pnpm workspace and the Turbo graph, orchestrated via docker-compose
   (ticket 07) plus a few root convenience scripts.
3. **uv over poetry** for the Python module — faster, single tool for
   venv+deps+lock, clear momentum.

## Decision

**Tooling**

- **Package manager + workspaces:** pnpm (content-addressed store, strict deps,
  the monorepo-ecosystem default Turborepo assumes).
- **Task runner:** Turborepo (caching + affected-detection over the TS packages).
- **JS runtime:** Node.
- **Python:** its own `uv`-managed project, **not** part of the pnpm workspace
  or the Turbo graph.

**Layout**

```
tuju-project/
├── apps/
│   ├── frontend/             # TanStack Start        (pkg: @tuju/frontend)
│   └── backend/              # NestJS                (pkg: @tuju/backend)
├── services/
│   └── ai/                   # Python + LangGraph, uv-managed (deployable: tuju-ai)
│       ├── pyproject.toml
│       └── src/
├── packages/
│   └── contracts/            # shared TS job/result/progress schema (pkg: @tuju/contracts)
│                             # cross-language contract seam — ticket 08 fills it
├── docs/adr/
├── package.json              # root: pnpm workspaces + turbo
├── pnpm-workspace.yaml       # lists apps/*, packages/*  — deliberately NOT services/ai
├── turbo.json
└── docker-compose.yml        # frontend, backend, ai, redis, db  (ticket 07 details this)
```

- **`services/` is separate from `apps/`** as the visual language boundary:
  `apps/*` + `packages/*` are the TS world Turbo manages; `services/ai` is the
  Python world it does not.
- **Folder names carry no `tuju-project-` prefix** (the repo path already
  supplies identity). Project identity lives in **package/deployable names**
  (`@tuju/*`, `tuju-ai`), where it surfaces in logs, registries, and compose
  service names.
- **`packages/contracts/`** is a first-class citizen reserved now so the
  ticket-08 job contract has a home on the TS side.

## Consequences

**Positive**

- Mainstream, low-friction shape; scales structurally by adding `packages/*`
  and apps without reshaping the repo.
- Python's environment stays clean and self-owned; no fake `package.json` to
  maintain.
- Every piece talks through the `JobBus` + `contracts` seam and never via shared
  code imports across the language boundary, so the AI worker (and later
  Products B/C surfaces) can be **extracted to its own repo at low cost** — the
  monorepo is a convenience, not a cage. This satisfies the "must not preclude
  Products B/C" force.

**Negative / risks**

- **Turbo caching and affected-detection stop at the Python boundary** — the
  price of "Python as its own world." A Python-only change gets no Turbo
  incremental smarts. Acceptable now; revisit the `package.json`-shim option (or
  Nx) only if the Python side grows into many packages.
- **No enforced module boundaries** (as Nx would give). At small-team /
  ~500-user scale, review discipline suffices.
- **Cross-language contract drift is the top structural risk** at scale: TS and
  Python can disagree on a payload shape with nothing catching it at build time,
  since Turbo can't see the Python side. This layout only *reserves* the seam
  (`packages/contracts/`); **ticket 08 must solve it** (single schema source
  generating both TS types and Python models).

## Scalability notes (why this holds)

- **Runtime/load:** governed by ADR-0001, not this layout — scale out by running
  more stateless Python worker replicas against the shared BullMQ queue. Comfortable
  well past the warm-500 launch; first real pinch points are Redis throughput and
  the DB (ticket 05), not the repo shape.
- **Structural:** good, with the contract seam being the one thing to get right.
- **Organizational:** services are cleanly extractable later thanks to the
  JobBus + contract isolation.

## Alternatives considered

- **Bun (runtime and/or package manager):** rejected as runtime because NestJS
  doesn't officially support it and its decorator-metadata DI is Bun's weak spot;
  rejected as package manager because Turborepo's ecosystem is pnpm-first and the
  only remaining Bun benefit (install speed) doesn't justify swimming against the
  defaults.
- **Nx instead of Turborepo:** its unique win here is pulling Python into one
  task graph (via a Python plugin), but that fights the reality that Python
  tooling wants to own its world; heavier upfront complexity not justified at
  this scale.
- **Plain pnpm scripts, no task runner:** leanest, viable early, but Turbo's
  caching/affected graph is cheap to adopt now and pays off as the TS side grows.
- **Python with a `package.json` shim (in the Turbo graph):** rejected — a fake
  manifest to maintain for caching we don't need yet; chosen against in favor of
  the honest language boundary.
- **poetry for Python:** viable; chosen against in favor of uv for speed and
  single-tool ergonomics.
