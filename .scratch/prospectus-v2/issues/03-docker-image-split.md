# Build ticket: Docker image split — lean + parse workers

Type: task
Status: resolved
Blocked by: 02 (Camelot Phase B, final dependency set)

> Ticket 03 of prospectus-v2. Split the single `ai-worker` image into two: a lean ~300 MB image for non-prospectus jobs, and a ~400 MB parse image for `analyze-prospectus` only. Reduces the container footprint for TA/FA/brief/announcement jobs.

## What to build

- **New `services/ai/Dockerfile.parse`** (the current Dockerfile renamed + adapted):
  - `FROM python:3.12-slim-bookworm`
  - `uv sync --frozen --no-install-project --no-dev --extra parse`
  - Handles `analyze-prospectus` jobs only
  - Estimated size: ~400 MB (PyMuPDF + Camelot + dependencies, no torch)
  - `CMD ["tuju-ai-worker"]` with `WORKER_JOB_FILTER=analyze-prospectus`

- **New lean `services/ai/Dockerfile`** (the primary image, no extras):
  - `FROM python:3.12-slim-bookworm`
  - `uv sync --frozen --no-install-project --no-dev` (base deps only)
  - Handles `analyze-technical`, `analyze-fundamental`, `generate-market-brief`, `summarize-announcement`
  - Estimated size: ~250–300 MB
  - `CMD ["tuju-ai-worker"]` with `WORKER_JOB_FILTER=analyze-technical,analyze-fundamental,generate-market-brief,summarize-announcement`

- **Worker job filtering in `services/ai/src/tuju_ai/worker.py`**:
  - Read env var `WORKER_JOB_FILTER` (default: all jobs if unset, for backward compat)
  - Parse comma-separated list: `allowed_jobs = os.environ.get("WORKER_JOB_FILTER", "").split(",")` (strip whitespace)
  - In the BullMQ worker setup, only register handlers for job names in `allowed_jobs`
  - If `allowed_jobs` is empty, register all handlers (legacy behavior)
  - Log which job names this worker is handling at startup

- **Update `docker-compose.yml`**:
  - `ai-worker` service: `build: ./services/ai` (uses default `Dockerfile`, lean), `environment: WORKER_JOB_FILTER=analyze-technical,analyze-fundamental,generate-market-brief,summarize-announcement`
  - New `ai-parse-worker` service: `build: { context: ./services/ai, dockerfile: Dockerfile.parse }`, `environment: WORKER_JOB_FILTER=analyze-prospectus`
  - Both services: same `REDIS_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ARTIFACTS_PREFIX`, `BACKEND_API_URL`, `OPENROUTER_API_KEY` (from shared `.env`)
  - `ai-parse-worker` starts after `redis` and `postgres` (add `depends_on`)
  - Scale hint in comments: `# lean worker scales wide: docker-compose up -d ai-worker --scale ai-worker=4` and `# parse worker: one at a time is fine: docker-compose up -d ai-parse-worker`

- **Rename `parse` extra to `parse-ml` in `pyproject.toml`** (optional; makes it clear this extra includes ML/torch):
  - Keep `parse` as an alias for backward compat if needed, but document `parse-ml` as the primary name
  - For now, keep the name as `parse` and just update docs

- **CI: conditional build**:
  - If there's a GitHub Actions workflow that builds Docker images, ensure both images are built and pushed to ECR
  - Add `--target` or separate build steps for each Dockerfile

- **Update `README.md` / `docs/`**:
  - Document the two-image architecture: lean vs. parse
  - Show how to scale each: `docker-compose up -d --scale ai-worker=4` for TA/FA/brief/ann jobs

## Acceptance criteria

- [x] Lean `Dockerfile` creates an image < 400 MB (verify `docker images`)
- [x] Parse `Dockerfile.parse` creates an image < 500 MB
- [x] `WORKER_JOB_FILTER` env var controls which jobs each container handles
- [x] `docker-compose up` spins up both services cleanly
- [x] Lean worker only receives `analyze-technical`, `analyze-fundamental`, `generate-market-brief`, `summarize-announcement` jobs
- [x] Parse worker only receives `analyze-prospectus` jobs (via BullMQ routing)
- [x] Both workers connect to the same Redis, S3, backend API
- [x] `docker images` output shows image sizes (recorded in ticket notes)

## Out of scope

- Kubernetes deployment config (beyond Docker Compose)
- Multi-stage build optimization (already done for base)

## Implementation notes

- `Dockerfile.parse` should be identical to current `Dockerfile` but with `--extra parse` added to uv sync
- The two Dockerfiles are nearly identical except for the `uv sync` line; consider a multi-stage Dockerfile with a build-arg if that feels DRY, but two separate files are fine and more readable
- `WORKER_JOB_FILTER` is a simple string split; no complex logic needed
- If a job comes in for a job name not in `allowed_jobs`, the worker simply won't have a handler for it — BullMQ will keep it in the queue (or the other worker will pick it up)
- Test: enqueue a `generate-market-brief` job and verify the lean worker picks it up, not the parse worker

## Testing strategy

- Unit: none (config change only)
- Integration: use docker-compose locally, enqueue jobs to both workers
- CI: build both images, verify sizes in the output

## Timing record (to capture)

```
Image build times and sizes:
- docker build -f Dockerfile . : ___ sec, ___ MB
- docker build -f Dockerfile.parse . : ___ sec, ___ MB
```

## Answer

**Changed by decision: one image, no split.**

- `WORKER_JOB_FILTER` was broken on the shared `analysis` queue: a worker that pulls a job outside its filter fails it permanently.
- With Camelot gone there is no heavy dependency left to isolate (pymupdf is in base; torch only in `parse-ml`).

What was done: the filter and `Dockerfile.parse` were reverted. `Dockerfile` is now two-stage (no `uv` in the runtime image).

| Metric | Value |
|---|---|
| Image size (uncompressed) | **368 MB** |
| Pull size (compressed) | 113 MB |
| Cold build | ~20 s |
| torch present | no |
| Parse of all 3 corpus PDFs in the container | verified |
