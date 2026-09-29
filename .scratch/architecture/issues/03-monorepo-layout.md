# Decide: monorepo tooling & layout (TS workspaces + Python coexistence)

Type: grilling
Status: resolved
Blocked by: (none)

## Question

Decide the monorepo tooling and folder layout given the locked stack (TanStack Start FE, NestJS BE, Python/LangGraph AI module).

Must settle:

- Top-level orchestration (e.g. pnpm workspaces + Turborepo?) and how tasks run across languages.
- How the **Python** AI module coexists with TS workspaces — its own top-level dir managed by `uv`/`poetry`, orchestrated (or not) by the JS tooling.
- The concrete folder structure: where FE, BE, AI, and any shared packages (e.g. shared types/contracts) live.
- Whether FE and BE are separate apps or whether any part of TanStack Start's server layer overlaps with NestJS's responsibilities (boundary clarity, not re-litigating the stack).

Output: an ADR recording the layout + a folder tree the executor can create verbatim.


## Answer

**Decision: pnpm workspaces + Turborepo on Node for the TS half; Python is its own uv-managed world outside the Turbo graph.** Locked as [ADR-0002](../../../docs/adr/0002-monorepo-pnpm-turborepo-python-own-world.md).

Settled the four required items:

- **Top-level orchestration:** pnpm (workspaces + install) + **Turborepo** (task graph/caching) on the **Node** runtime. Bun was challenged and rejected — NestJS anchors us to Node (official support + decorator-metadata DI is Bun's weak spot), which collapses Bun's value to "faster installs" that pnpm already covers.
- **Python coexistence:** its **own world** — `services/ai/` managed by **uv**, excluded from `pnpm-workspace.yaml` and the Turbo graph. Orchestrated via docker-compose (ticket 07) + a few root convenience scripts. Rejected the `package.json`-shim-into-Turbo option to keep the language boundary honest.
- **Folder tree:**
  ```
  apps/frontend   (TanStack Start, @tuju/frontend)
  apps/backend    (NestJS, @tuju/backend)
  services/ai     (Python+LangGraph, uv, deployable tuju-ai)
  packages/contracts  (@tuju/contracts — cross-language job/result/progress schema seam)
  + root package.json / pnpm-workspace.yaml (apps/*, packages/*) / turbo.json / docker-compose.yml
  ```
  `services/` split from `apps/` marks the language boundary; folder names carry no `tuju-project-` prefix (identity lives in `@tuju/*` package + `tuju-ai` deployable names).
- **FE/BE boundary:** separate apps (`apps/frontend` NestJS-agnostic TanStack Start; `apps/backend` NestJS owns the API + JobBus producer). Not re-litigated beyond confirming they're distinct deployables.

**Scalability (asked during the session):** runtime/load scaling is governed by ADR-0001 (scale out stateless Python workers on the shared BullMQ queue), not this layout — comfortable past the warm-500 launch, first pinch points are Redis + DB (ticket 05). Structurally sound; services are cleanly **extractable to their own repos later** (JobBus + contract isolation, no cross-language code imports) — this is how the layout satisfies the "must not preclude Products B/C" force. Conscious limits recorded in the ADR: Turbo caching stops at the Python boundary; no enforced module boundaries (Nx would add them, not needed yet).

**Top structural risk flagged for ticket 08:** cross-language contract drift (TS vs Python payload shapes, uncaught at build time since Turbo can't see Python). This ticket only *reserves* the `packages/contracts/` seam; ticket 08 must solve it with a single schema source generating both TS types and Python models. No new tickets or fog graduated — this decision informs (does not unblock) 08.
