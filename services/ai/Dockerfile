# syntax=docker/dockerfile:1
#
# Python AI worker image (ticket 06, ADR-0002/0006). Its own uv-managed world,
# built ONLY from services/ai (outside the pnpm/Turbo graph). Boots the BullMQ
# consumer (tuju-ai-worker), reaching Redis/S3 by connection-URL env vars.
#
# Python pinned to match services/ai/.python-version (3.12); uv provides the
# reproducible sync from the committed uv.lock.

FROM python:3.12-slim-bookworm AS base

# uv (pinned) — the Python world's package/lock manager (ADR-0002).
COPY --from=ghcr.io/astral-sh/uv:0.11.9 /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# ---- Deps layer: sync from the lockfile (cached on lock + manifest) ---------
# Copy only the files that define the environment so this layer caches until a
# dependency actually changes.
COPY services/ai/pyproject.toml services/ai/uv.lock services/ai/.python-version ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

# ---- Project layer: install the package itself ------------------------------
COPY services/ai/src ./src
COPY services/ai/README.md ./README.md
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# uv installs into /app/.venv; put it on PATH so the console script runs.
ENV PATH="/app/.venv/bin:$PATH"

# Boots the BullMQ worker consuming the `analysis` queue (ADR-0001). Blocks on a
# live Redis (REDIS_URL) and writes artifacts to S3 (S3_ENDPOINT/S3_BUCKET).
CMD ["tuju-ai-worker"]
