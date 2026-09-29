# Scaffold: root monorepo workspace (pnpm + Turborepo + uv skeleton)

Status: done
Done in: 863ec86
Blocked by: (none)
Implements: ADR-0002

## Task

Stand up the empty monorepo shell that everything else slots into.

- `pnpm-workspace.yaml` declaring `apps/*`, `packages/*` (NOT `services/ai` — Python
  is its own uv world outside the pnpm/Turbo graph, ADR-0002).
- Root `package.json` (private), `turbo.json` with `build`/`test`/`lint`/`typecheck`
  pipeline stubs.
- Directory skeleton: `apps/frontend`, `apps/backend`, `services/ai`,
  `packages/contracts` (empty placeholders with a `.gitkeep` or minimal
  `package.json`/`pyproject.toml`).
- Root tooling: `.gitignore` (node_modules, dist, `.env`, `__pycache__`, `.venv`,
  uv/turbo caches), `.nvmrc` or `engines` pinning Node, `.editorconfig`.
- `services/ai/pyproject.toml` initialised via **uv** (`uv init`), Python version pinned.
- `.env.example` at root with fake placeholder values (ADR-0009); real `.env` gitignored.
- Root README documenting the two-world layout and `docker compose up` (stub for now).

## Done when

`pnpm install` succeeds at root; `turbo run build` runs (no-op is fine); `uv sync`
succeeds in `services/ai`. No app code yet.

## Notes

The pnpm/Turbo graph must NOT include `services/ai` — that boundary is the whole point
of ADR-0002. Verify Node + Turbo + pnpm versions at scaffold time and pin them.
