# syntax=docker/dockerfile:1
#
# Frontend image (ticket 06, ADR-0005). Static SPA build served by nginx — a CDN
# artifact in prod; a static container here so the full stack is present. Built
# from the pnpm/Turborepo workspace ROOT context so @tuju/contracts resolves.
#
# VITE_API_BASE_URL is inlined at build time (Vite): the browser talks to the
# backend on the host-published port. Keep-it-migratable: the FE never hardcodes
# backend URLs beyond this single configurable base (ADR-0005).

FROM node:24.16.0-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
ARG VITE_API_BASE_URL=http://localhost:3000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
# TanStack Start's SPA prerender spins up an ephemeral local SSR server and
# crawls it. In slim containers `localhost` can resolve to ::1 while the server
# binds 127.0.0.1 (or vice-versa), yielding ECONNREFUSED — force IPv4-first so
# the crawler reaches its own server.
ENV NODE_OPTIONS=--dns-result-order=ipv4first
COPY packages/contracts packages/contracts
COPY apps/frontend apps/frontend
RUN pnpm exec turbo run build --filter=@tuju/frontend

# ---- Runtime: nginx serving the static SPA ---------------------------------
FROM nginx:1.27-alpine AS runtime
# TanStack Start static SPA client output (Vite): dist/client/ holds the shell
# (_shell.html) + hashed asset bundle.
COPY --from=build /repo/apps/frontend/dist/client /usr/share/nginx/html
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
