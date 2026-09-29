#!/bin/sh
# Backend container entrypoint (ticket 06, ADR-0004/0006).
#
# 1. Run TypeORM migrations (idempotent) so the analysis_results table exists on
#    boot — NestJS is the sole schema owner (synchronize is OFF).
# 2. Start the compiled server (dist/main.js).
#
# All connection targets come from the environment (DATABASE_URL, REDIS_URL,
# S3_ENDPOINT/S3_BUCKET) — no hardcoded hosts (ADR-0006 invariant).
set -e

echo '{"level":"info","msg":"backend.entrypoint.migrate","step":"migration:run"}'
pnpm run migration:run

echo '{"level":"info","msg":"backend.entrypoint.start","step":"node dist/main.js"}'
exec node dist/main.js
