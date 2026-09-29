# tuju-ai

Python + LangGraph AI worker for the Bursa platform.

**This is its own uv-managed world** — deliberately outside the pnpm workspace and
the Turborepo task graph (ADR-0002). It talks to the rest of the system only through
the Redis + BullMQ JobBus (ADR-0001) and the shared contract seam (`packages/contracts`,
ADR-0007), never via cross-language code imports. This keeps it cleanly extractable to
its own repo later.

## Local development

```bash
# from repo root
uv sync --project services/ai      # or: pnpm run ai:sync
uv run --project services/ai pytest  # or: pnpm run ai:test

# from within services/ai
uv sync
uv run pytest
```

Skeleton only — the LangGraph worker is filled by scaffold ticket 05.
