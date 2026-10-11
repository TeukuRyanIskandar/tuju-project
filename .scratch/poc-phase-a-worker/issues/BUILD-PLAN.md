# Implementation Plan: PoC Phase A Worker Build

Label: `spec:build-plan`

Three tickets implement the worker handoff spec (`spec.md`). Execute in order:

1. **08-be-reference-endpoint.md** — Backend `GET /stocks/:code/analysis/reference` + TA event computation
   - Deliverables: `technical-events.ts`, `analysis-reference.ts`, `StocksService.getAnalysisReference()`, controller route
   - Tests: pure unit tests for event detection
   - Gating: worker needs this endpoint to fetch facts

2. **09-be-facts-only-hook.md** — Wire `facts-only:` headline prefix to `FactsOnly` status
   - Deliverables: One-line changes to `technical-analysis.store.ts` + `fundamental-analysis.store.ts`, test cases
   - Tests: Update `stock-analysis.store.spec.ts`
   - Depends on: 08 (the worker will produce the `facts-only:` headlines)

3. **10-worker-ta-fa-handlers.md** — Python handlers, grounding check, LLM narration, cost tracking
   - Deliverables: `ta_fa_analysis.py`, `BackendClient.get_analysis_reference()`, `handler.py` dispatch changes
   - Tests: New `test_ta_fa_analysis.py` + update `test_handler.py`
   - Depends on: 08 (backend reference endpoint must exist)

## Cross-ticket dependencies

```
08 (BE reference endpoint)
  ↓
10 (Python handlers use GET /stocks/:code/analysis/reference)
  ↓
09 (BE hook consumes facts-only: headlines from worker)
```

Execution order: 08 → 10 → 09 (or 08 → {09, 10} in parallel after 08 completes).

## Final checks

After all three tickets:
- `pnpm --filter backend typecheck` — TS type checking
- `pnpm --filter backend test` — unit tests
- `pnpm --filter backend test:int` — integration tests (testcontainers)
- `uv run --project services/ai pytest -m unit` — Python unit tests
- All existing tests must pass (no regressions)

## Map status

**Destination reached.** All 6 decisions (01–06) are resolved. Spec is locked. Tickets ready for agent execution.
