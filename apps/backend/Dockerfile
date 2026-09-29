# syntax=docker/dockerfile:1
#
# NestJS backend image (ticket 06, ADR-0006). Built from the pnpm/Turborepo
# workspace ROOT context so the @tuju/contracts workspace dependency resolves.
# Multi-stage: install+build with the full toolchain, then a lean runtime that
# runs the TypeORM migration on boot (so the backend entity exists) and starts.
#
# Node pinned to match .nvmrc (24.16.0); pnpm pinned via corepack to the repo's
# packageManager field (11.3.0).

# ---- Base: Node + pnpm via corepack ----------------------------------------
FROM node:24.16.0-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
WORKDIR /repo

# ---- Deps: install the whole workspace (cached on lockfile) ----------------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
RUN pnpm install --frozen-lockfile

# ---- Build: compile contracts + backend via the Turbo graph ----------------
FROM deps AS build
COPY packages/contracts packages/contracts
COPY apps/backend apps/backend
# Build only the backend and its workspace dep (@tuju/contracts) via Turbo's
# ^build edge — the frontend is a separate image and is not needed here.
RUN pnpm exec turbo run build --filter=@tuju/backend

# ---- Runtime: lean prod image ----------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /repo

# Bring the installed workspace + built artifacts. node_modules carries the
# symlinked @tuju/contracts (built dist) and the backend's prod deps.
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /repo/packages/contracts ./packages/contracts
COPY --from=build /repo/apps/backend ./apps/backend

WORKDIR /repo/apps/backend

# Entry: run migrations (idempotent) then boot. Migrations create the
# analysis_results table (ADR-0004) so the entity exists on first boot.
# Reaches Postgres/Redis by DATABASE_URL/REDIS_URL (ADR-0006 connection-by-env).
COPY apps/backend/docker-entrypoint.sh /usr/local/bin/backend-entrypoint.sh
RUN chmod +x /usr/local/bin/backend-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/backend-entrypoint.sh"]
