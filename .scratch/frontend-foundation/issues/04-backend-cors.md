# Backend CORS

Type: task
Status: done
Blocked by: (none)

> Access-control change. Call it out in the commit and summary.

## Task

The browser talks to NestJS directly from a different origin (ADR-0005) and
needs the session cookie, but `apps/backend/src/main.ts` never enables CORS.

- Add `CORS_ORIGINS` to `apps/backend/src/config/config.ts`: a comma-separated
  allowlist, defaulting to `http://localhost:5173` in dev.
- In `main.ts`, call `app.enableCors({ origin: allowlist, credentials: true })`.
- Reject `*` (and empty entries) at startup, because a wildcard origin cannot be
  combined with credentials.
- Update the backend env example and the `docker-compose.yml` env section.
- Follow how other config values are parsed and tested in `config.ts`.

## Done when

- Unit tests cover config parsing, including rejecting `*`.
- An integration test asserts `Access-Control-Allow-Origin` and
  `Access-Control-Allow-Credentials` for an allowed origin and their absence for
  any other origin.
- Backend `typecheck` and `test` pass.

## Open question (do not decide here)

The production SPA origin and shared parent domain from ADR-0005.

## Comments

**Implementation note (agent)**

Files changed:
- `apps/backend/src/config/cors.ts` (new): `parseCorsOrigins` (default `http://localhost:5173`, trims, rejects any `*` and empty entries incl. blank/trailing comma) and `applyCors`.
- `apps/backend/src/config/cors.spec.ts` (new): parsing unit tests, `loadConfig` tests, and HTTP header tests.
- `apps/backend/src/config/config.ts`: `AppConfig.corsOrigins` from `CORS_ORIGINS`.
- `apps/backend/src/main.ts`: `applyCors(app, config.corsOrigins)`.
- `.env.example`, `docker-compose.yml` (backend env; defaults to `:5173` and `:8080`, overridable via `CORS_ORIGINS`).

Deviation from the ticket text: `applyCors` uses a per-request options delegate instead of a static `enableCors({ origin: allowlist, credentials: true })`. With the static form the `cors` package still sends `Access-Control-Allow-Credentials: true` to disallowed origins (caught by the test). The delegate gives allowed origins the same headers and disallowed origins none.

The header test uses a minimal Nest app (stub controller + `applyCors`) over real HTTP on an ephemeral port, so it needs no Postgres/Redis/Docker and runs in the default `test` lane. It is not an `*.int.spec.ts` testcontainers test.

Verified (in a `node:24-slim` container, since the host has no Node; repo mounted, existing node_modules):
- `tsc -p tsconfig.json --noEmit`: pass.
- jest, excluding `*.int.spec.ts`/`*.int-spec.ts` (need testcontainers): 27 suites / 307 tests pass, including 20 new in `cors.spec.ts`.

Not verified: the existing Docker-dependent `*.int.spec.ts` suites were not run; `docker compose up` was not run, nor a real browser request against the booted app (`main.ts` wiring is only typechecked); `pnpm` scripts were not run directly (equivalent `tsc`/`jest` binaries were used).

Open question (unchanged): production SPA origin / shared parent domain (ADR-0005).
