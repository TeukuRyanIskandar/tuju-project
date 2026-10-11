# Decide: TA/FA handler shape + failure classes + progress

Type: grilling
Status: resolved
Blocked by: 01

## Question

Pin the real TA/FA handling that replaces the ADR-0003 stub, mirroring the
prospectus handler's patterns:

1. Graph shape: flat handler functions (the prospectus path — validate →
   fetch → analyse → claim-check → result) vs an actual LangGraph
   `StateGraph` for the fetch → facts → narrate → post-check → assemble
   flow? Is LangGraph machinery worth it for a linear ~5-step path?
2. Progress steps: per-job step plan using the **locked** phase enums —
   TA `fetching-market-data` / `computing-indicators` / FA
   `fetching-financials` / `computing-metrics`, both with
   `synthesizing-verdict` (semantically "drafting narrative"),
   `persisting-artifact`, `done`? Heartbeat needed? (All steps are fast —
   no Docling-style long parse.)
3. Failure classes (ADR-0007 §6 mapping, prospectus precedent): terminal
   (no API key, unknown symbol / 404 reference, malformed reference, empty
   facts, malformed LLM output after retry, grounding strip per ticket 04,
   cost ceiling per ticket 06) vs transient/retried (backend 5xx, LLM
   timeout / 429 / 5xx)?
4. `JobResult.jobId` minting: the BE hook's colon forms
   `technical:<stockCode>:1D:<asOfBucket>` /
   `fundamental:<stockCode>:quarterly:<asOfBucket>` (the current stub mints
   `ta:…` / `fa:…` and is **not** parsed — must change); `SystemSummary`
   only (verdict-bearing `Summary` stays unused in PoC).
5. Artifact key layout under the claim-check prefix: current stub writes
   `ta/<symbol>/<bucket>.json`; prospectus writes
   `prospectus/<id>/at-a-glance.json`. Pin the PoC layout (BE hook + proxy
   read the pointer, not the path — this is tidiness + debuggability).
6. Test strategy (ADR-0011): unit (FakeLLMClient, httpx MockTransport
   BackendClient, no network), contract goldens incl. the contracts-map
   fixtures `job-result-technical-system.json` /
   `job-result-fundamental-system.json`, and the integration layer split.

Fixed inputs: ADR-0003, ADR-0007 §4–§6, ADR-0011; prospectus handler prior
art (`services/ai/src/tuju_ai/handler.py`); BE build map jobId pins
(`stock-analysis.upsert.ts`).

## Notes

- Whether the LangGraph package stays at all is in play: ADR-0003 scoped a
  trivial stub; the real flow may be plain functions like prospectus. A
  no-graph answer should note the ADR-0003 follow-up (amendment note, not
  this map).

## Answer

### 1. Graph shape: **flat functions, drop LangGraph for TA/FA**

The prospectus handler is a pure flat sequence with no `StateGraph` machinery at all. The PoC TA/FA flow is equally linear:
`validate → fetch reference → assemble facts → narrate → post-check → claim-check → result` — no conditional branching, parallel fan-out, or checkpointed retries. LangGraph's machinery (routing, conditional branches, multi-step recovery) is not used here.

The current `graph.py` stub is a 3-node `StateGraph` with zero conditionality; the real handlers will also be straight-line. Using `StateGraph` for a linear pipeline adds import weight, a compiled-graph object, and a `TypedDict` state type with no architectural return.

**Decision: implement `_handle_technical_job` / `_handle_fundamental_job` as flat private functions, mirroring `_handle_market_brief` / `_handle_prospectus`.** Remove `graph.py` and the `langgraph` dependency when those functions are the only consumers.

**Follow-up: amend ADR-0003** to note the TA/FA decision. The ADR explicitly left open "whether the LangGraph package stays at all" with the note that "a no-graph answer should note the ADR-0003 follow-up (amendment note, not this map)" — that amendment will be a brief additive paragraph noting the PoC choice and the architectural reasoning (linear flow + no branching = functions, not graphs).

### 2. Progress steps: **locked enums, no heartbeat**

Use the locked phase enums from `packages/contracts/src/enums.ts` exactly as defined (ADR-0007 §4):
- TA: `queued` → `fetching-market-data` → `computing-indicators` → `synthesizing-verdict` → `persisting-artifact` → `done` (stepTotal = 5)
- FA: `queued` → `fetching-financials` → `computing-metrics` → `synthesizing-verdict` → `persisting-artifact` → `done` (stepTotal = 5)

**No heartbeat.** The `_heartbeat` pattern exists for the 4–11 minute Docling parse on the prospectus job. All TA/FA steps are fast (reference fetch < 1s, fact assembly in-process, one LLM call ~ 10s typical, S3 write < 1s). No step warrants a keep-alive beat.

### 3. Failure classes: **terminal vs transient, mirror prospectus**

Terminal (`TerminalJobError` → BullMQ `UnrecoverableError` / no retry):
- No API key (`LLMConfigError` — ticket 05 context)
- Unknown symbol / 404 reference endpoint → `httpx.HTTPStatusError` with status_code == 404 → raise `TerminalJobError`
- Malformed reference response → `ValidationError` on BackendClient response → `TerminalJobError`
- Empty facts block → first-class check, raise `TerminalJobError` (ticket 01 to specify conditions)
- Malformed LLM output after exhaustion → `MalformedModelOutput` / `LLMPermanentError` → `TerminalJobError` (ticket 03)
- Grounding strip failure → `TerminalJobError` (ticket 04 to define)
- Cost ceiling exceeded → `CostCeilingExceeded` → `TerminalJobError` (ticket 06)
- Bad envelope (ValidationError on JobEnvelope) → `TerminalJobError`

Transient (allow to propagate, BullMQ retries with 5s→15s→30s backoff per ADR-0007 §6):
- Backend 5xx — `httpx.HTTPStatusError` with status >= 500 → reraise (not a 404)
- LLM timeout / rate-limit / 5xx — `httpx.TimeoutException`, `HTTPStatusError` with codes 429/5xx → reraise
- Any other network blip → reraise

Pattern: adopt the prospectus handler's exact structure (lines 438–444) — catch `HTTPStatusError`, branch on 404 → terminal, reraise otherwise.

### 4. `JobResult.jobId` minting: **colon form with timeframe/period segment**

**Hard constraint from the map.** The BE hook (`apps/backend/src/analysis/stock-analysis.upsert.ts`) parses `TECHNICAL_JOB_RESULT_PREFIX = 'technical:'` and `FUNDAMENTAL_JOB_RESULT_PREFIX = 'fundamental:'` forms by splitting on `:` and extracting the stock code at index [1]. The jobId must include the timeframe/period segment for dedup correctness (a 1W run and a 1D run on the same symbol are independent jobs).

**Decision:**
- TA: `technical:{stockCode}:1D:{asOfBucket}` (e.g. `technical:1155:1D:2026-10-08T18`)
- FA: `fundamental:{stockCode}:quarterly:{asOfBucket}` (e.g. `fundamental:1155:quarterly:2026-10-08T18`)

Implement in `_handle_analysis_job`:
```python
job_prefix = "technical" if job_name == JOB_ANALYZE_TECHNICAL else "fundamental"
anchor_value = envelope.payload.timeframe if job_name == JOB_ANALYZE_TECHNICAL else envelope.payload.period
job_id = f"{job_prefix}:{symbol}:{anchor_value}:{as_of_bucket}"
```

**`SystemSummary` only** (no `verdict` field). The PoC uses verdict-less summaries for TA/FA. The contract union `summary: Summary | SystemSummary` already supports this; TA/FA handlers return `SystemSummary(headline=..., asOf=...)`.

### 5. Artifact key layout: **symmetric with jobId, under per-job prefix**

**Decision:**
- TA: `analysis/technical/{stockCode}/{asOfBucket}.json`
- FA: `analysis/fundamental/{stockCode}/{asOfBucket}.json`

This mirrors the prospectus pattern (`prospectus/{prospectusId}/at-a-glance.json`) and the jobId scheme. The BE hook and proxy read via `JobResult.pointer`, not a hardcoded path, so this is a tidiness + debuggability choice with no functional wire impact.

### 6. Test strategy: **unit + contract goldens + integration (testcontainers)**

**Unit layer** (`pytest.mark.unit`):
- `FakeLLMClient` (already in `llm/fake.py`)
- `FakeBackendClient` for reference endpoint (same pattern as existing `test_handler.py`)
- `FakeS3` (already in `test_handler.py`)
- No network, no Docker
- Coverage:
  - Happy path TA + FA (return contract-valid `JobResult` with `SystemSummary`, correct jobId format, artifact written under correct prefix)
  - Bad envelope → `TerminalJobError`
  - 404 reference → `TerminalJobError`
  - Empty facts → `TerminalJobError` (ticket 01 to spec the condition)
  - Malformed reference response → `TerminalJobError`
  - Bad LLM output → `TerminalJobError` (ticket 03)
  - Grounding failure → `TerminalJobError` (ticket 04)
  - Cost ceiling → `TerminalJobError` (ticket 06)
  - Progress sequence: stepIndex 0→5 monotonic, phases match locked enum, phase labels rendered

**Contract golden fixtures** (in `packages/contracts/test/fixtures.test.ts` + `services/ai/tests/test_contracts_conformance.py`):
- Validate `job-result-technical-system.json` / `job-result-fundamental-system.json` against `JobResult` Zod + Pydantic *(already passing)*
- Validate `technical-analysis-artifact.json` / `fundamental-analysis-artifact.json` against `TechnicalAnalysisArtifact` / `FundamentalAnalysisArtifact` Zod + Pydantic *(fixtures exist; assertions wired by ticket 01)*

**Integration layer** (`pytest.mark.integration`):
- Testcontainers Redis + LocalStack; real BullMQ enqueue → Python worker → `completed` event → check S3 artifact present + `JobResult` contract-valid + Postgres row upserted (BE integration)
- Skippable with marker until the BE reference endpoint ships real market-data fixtures (ADR-0011 pattern — `pytest.mark.skipif(no-fixtures)`)
- Coordinates with ticket 01 (fact assembly) and ticket 04/06 (grounding / cost ceiling) to test the full end-to-end path

## Implementation (tickets 01–06 execution)

The shape decisions above lock the structure. Tickets 01–06 build the handlers:
1. **Ticket 01** — fact assembly + reference endpoint: implement `_handle_technical_job` / `_handle_fundamental_job` as flat functions, call `backend_client.get_analysis_reference(code)`, assemble facts, return (no narration yet)
2. **Ticket 03** — narration prompt: wire the LLM call into the handler, assemble narrative
3. **Ticket 04** — grounding post-check: add the strip logic, raise `TerminalJobError` if checks fail
4. **Ticket 05** — facts-only signal: wire the `facts_only` flag to skip narration or surface an alternate artifact
5. **Ticket 06** — cost ceiling: wrap the LLM call with `CostTracker`, raise `TerminalJobError` on ceiling
6. **Ticket 07** — worker handoff: finalize the spec

None of these tickets require revisiting the graph / failure shape / jobId / artifact key / test structure decisions above. They execute within the locked frame.
