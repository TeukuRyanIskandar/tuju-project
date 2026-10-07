# tuju-ai

Python + LangGraph AI worker for the Bursa platform.

**This is its own uv-managed world** — deliberately outside the pnpm workspace and
the Turborepo task graph (ADR-0002). It talks to the rest of the system only through
the Redis + BullMQ JobBus (ADR-0001) and the shared contract seam (`packages/contracts`,
ADR-0007), never via cross-language code imports. This keeps it cleanly extractable to
its own repo later.

## What it does

A stateless job consumer:

- **JobBus worker (ADR-0001):** consumes the `analysis` queue over Redis, connection
  URL by env (ADR-0006). Job names:
  - `analyze-technical` / `analyze-fundamental` — LangGraph stub, placeholder artifact.
  - `generate-market-brief` — system-triggered daily brief (spec 06): reads
    `GET /market/indices` from the NestJS API and narrates the moves.
  - `summarize-announcement` — system-triggered per-announcement summary (spec 06):
    reads the announcement's metadata from the NestJS API.

  Both showcase jobs are **deterministic templates — no LLM call yet** — and return
  a verdict-less `SystemSummary`. The brief flags its data as illustrative/synthetic.
- **Stateless reader (ADR-0004):** data reads go through NestJS's anonymous read API
  (`backend_client.py`, `BACKEND_API_URL`), never Postgres directly.
- **Runtime conformance (ADR-0011):** validates the incoming `JobEnvelope` and the
  outgoing `JobResult` against the generated Pydantic v2 models (`contracts_generated`).
- **Step-based progress (ADR-0007 §4):** emits `JobProgress` via `job.updateProgress`.
- **Claim-check (ADR-0004):** writes the artifact to S3 (LocalStack locally) and
  returns `job.returnvalue` = pointer + thin summary. Never writes Postgres.
- **Structured logging (ADR-0010):** JSON to stdout, `correlationId` on every line.
- **Prospectus pipeline (spec 06, LLM-free so far):** `prospectus/` parses a PDF once
  with Docling, routes the four regulated Bursa/SC sections by heading (explicit
  whole-document fallback), and claim-checks the parse to S3 idempotently (keyed by
  prospectus + PDF sha). Standalone entrypoint: `tuju-ai-prospectus-parse`. Docling
  lives in the optional `parse` extra (the worker image installs it). The
  at-a-glance LLM analysis job is not built yet.

Real TA/FA indicator/metric logic is out of scope here (indicators are computed in
the NestJS ingestion worker, ADR-0012).

## Layout

```
src/tuju_ai/
├── config.py               env-driven settings (Redis URL, S3, backend API) — ADR-0006
├── logging_config.py       structured JSON stdout logging — ADR-0010
├── graph.py                trivial LangGraph stub (TA/FA jobs) — ADR-0003
├── market_brief.py         templated daily market brief narrative (spec 06)
├── announcement_summary.py templated plain-language announcement summary (spec 06)
├── backend_client.py       thin httpx client for the NestJS read API — ADR-0004
├── artifacts.py            S3 claim-check writer → ArtifactPointer — ADR-0004
├── handler.py              pure job handler: dispatch by job name → JobResult
├── worker.py               BullMQ JobBus adapter (entrypoint: tuju-ai-worker)
├── smoke.py                offline smoke run, no infra (entrypoint: tuju-ai-smoke)
├── prospectus/
│   ├── models.py           internal parse / routed-section models (not wire contract)
│   ├── parsing.py          Docling parse adapter (lazy import; `parse` extra)
│   ├── skeleton.py         regulated Bursa/SC section heading patterns
│   ├── router.py           heading-based section router + whole-doc fallback
│   ├── store.py            idempotent S3 claim-check of the parse
│   └── cli.py              entrypoint: tuju-ai-prospectus-parse
└── contracts_generated/    generated Pydantic models (do not edit)
scripts/
└── inspect_corpus.py       one-off: dump demo-corpus heading skeletons (not a test)
tests/
├── test_handler.py                  handler dispatch (unit)
├── test_market_brief.py             market brief template (unit)
├── test_announcement_summary.py     announcement summary template (unit)
├── test_smoke.py                    offline smoke entrypoint (unit)
├── test_contracts_conformance.py    golden-fixture cross-language conformance (unit)
├── test_prospectus_router.py        section router (unit)
├── test_prospectus_parse_store.py   parse persistence / idempotency (unit)
├── test_prospectus_corpus.py        real demo-corpus PDFs via Docling (corpus)
└── test_integration_jobbus.py       JobBus round-trip, testcontainers (integration)
```

## Local development

Pytest markers (`pyproject.toml`): `unit` (no infra), `integration` (testcontainers
Redis + LocalStack; needs Docker), `corpus` (real PDFs via Docling; needs the `parse`
extra, slow). The PR lane runs `-m "not integration and not corpus"`.

```bash
# from repo root
uv sync --project services/ai          # or: pnpm run ai:sync
uv run --project services/ai pytest     # or: pnpm run ai:test

# from within services/ai
uv sync                                       # add --extra parse for Docling
uv run pytest -m "not integration and not corpus"   # fast lane
uv run pytest -m integration                  # testcontainers JobBus round-trip
uv run pytest -m corpus                       # demo-corpus parse (needs --extra parse)
uv run tuju-ai-smoke                          # offline smoke: full handler path, no Redis/S3
uv run tuju-ai-worker                         # boot the worker (needs Redis; S3; backend API)
uv run tuju-ai-prospectus-parse --prospectus-id <id> --pdf <path>   # parse + route one PDF
```
