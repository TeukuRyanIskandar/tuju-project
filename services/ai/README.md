# tuju-ai

Python + LangGraph AI worker for the Bursa platform.

**This is its own uv-managed world** — deliberately outside the pnpm workspace and
the Turborepo task graph (ADR-0002). It talks to the rest of the system only through
the Redis + BullMQ JobBus (ADR-0001) and the shared contract seam (`packages/contracts`,
ADR-0007), never via cross-language code imports. This keeps it cleanly extractable to
its own repo later.

## What it does (scaffold — ticket 05)

A stateless job consumer:

- **JobBus worker (ADR-0001):** consumes the `analysis` queue (`analyze-technical` /
  `analyze-fundamental`) over Redis, connection URL by env (ADR-0006).
- **Runtime conformance (ADR-0011):** validates the incoming `JobEnvelope` and the
  outgoing `JobResult` against the generated Pydantic v2 models (`contracts_generated`).
- **Step-based progress (ADR-0007 §4):** emits `JobProgress` via `job.updateProgress`.
- **Claim-check (ADR-0004):** writes a placeholder artifact to S3 (LocalStack locally)
  and returns `job.returnvalue` = pointer + thin summary. Never writes Postgres.
- **LangGraph stub (ADR-0003 scope):** a trivial 3-node graph — no real TA/FA logic.
- **Structured logging (ADR-0010):** JSON to stdout, `correlationId` on every line.

Real TA/FA indicator/metric logic is a later feature effort, explicitly out of scope.

## Layout

```
src/tuju_ai/
├── config.py               env-driven settings (Redis URL, S3) — ADR-0006
├── logging_config.py       structured JSON stdout logging — ADR-0010
├── graph.py                trivial LangGraph stub — ADR-0003
├── artifacts.py            S3 claim-check writer → ArtifactPointer — ADR-0004
├── handler.py              pure job handler (validate → graph → claim-check → JobResult)
├── worker.py               BullMQ JobBus adapter (entrypoint: tuju-ai-worker)
├── smoke.py                offline smoke run, no infra (entrypoint: tuju-ai-smoke)
└── contracts_generated/    generated Pydantic models (ticket 02; do not edit)
tests/
├── test_handler.py                  unit tests (no infra) — ADR-0011
├── test_contracts_conformance.py    golden-fixture cross-language conformance
└── test_integration_placeholder.py  testcontainers placeholder (ticket 07)
```

## Local development

```bash
# from repo root
uv sync --project services/ai          # or: pnpm run ai:sync
uv run --project services/ai pytest     # or: pnpm run ai:test

# from within services/ai
uv sync
uv run pytest                # unit layer (13 pass, integration skipped)
uv run tuju-ai-smoke         # offline smoke: full handler path, no Redis/S3
uv run tuju-ai-worker        # boot the worker (needs live Redis; S3 for artifacts)
uv run pytest -m integration # testcontainers layer (placeholder until ticket 07)
```
