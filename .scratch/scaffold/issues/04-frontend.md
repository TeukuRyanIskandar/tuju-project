# Scaffold: apps/frontend — TanStack Start 1.x (static SPA) + contract types

Status: done
Done in: f0e326b (merged 3a8f608)
Blocked by: 02
Implements: ADR-0002, ADR-0005, ADR-0010

## Task

Scaffold the frontend as a static SPA (ADR-0005: no BFF for Product A; SSR deferred).

- **TanStack Start 1.x** app in `apps/frontend` via `@tanstack/create-start`
  (Vite build tool). Integrate into the pnpm/Turbo workspace (ADR-0002).
- Configure as a **static SPA build** for v1 (SSR capability kept but not used —
  ADR-0005 keeps SSR/BFF a cheap additive migration). Configurable **API base URL**
  by env (ADR-0005 migration lever).
- Consume `packages/contracts` TS types for API/job shapes (shared types, no drift).
- Auth surface: talk to the backend session cookie (httpOnly, ADR-0005); tier =
  show/hide only on the FE (no enforcement — that's the backend's job).
- One placeholder route + a call to backend `/health` to prove end-to-end wiring.
- **Tests** (ADR-0011): **Vitest**; one component/unit test.

## Done when

`pnpm --filter frontend build` produces a static bundle; `dev` server renders the
placeholder route and successfully calls backend `/health` (with API base by env);
Vitest test passes.

## Notes

TanStack Start reached stable v1.0 (Sept 2025); use the current `create-start` CLI and
verify the exact package name/version at scaffold time (`@tanstack/create-start` /
`create-start-app`). Choose the Vite (not Rsbuild) path unless a reason emerges.
