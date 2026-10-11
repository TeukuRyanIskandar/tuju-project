# Build: Python TA/FA handlers (core logic)

Type: task
Status: done
Blocked by: 08-be-reference-endpoint

## Scope

Implement flat `_handle_technical_job()` and `_handle_fundamental_job()` handlers replacing the ADR-0003 stub, with fact assembly, LLM narration, grounding check, and cost tracking.

### Deliverables

1. **Extend `BackendClient` protocol + `HttpBackendClient`** (`backend_client.py`):
   - Add `get_analysis_reference(symbol: str) -> dict[str, Any]` method
   - Implementation: `GET /stocks/{symbol}/analysis/reference`
   - Docstring documents expected response shape (from spec contract)

2. **New module `services/ai/src/tuju_ai/ta_fa_analysis.py`** — Core logic:

   **Grounding check** — `check_grounding(text: str, facts: dict, events: list) -> tuple[bool, str | None]`
   - Number extraction regex + containment check (all numbers in narrative must appear verbatim in facts/events)
   - Ban-word scan (case-insensitive substring): "buy", "sell", "hold", "target", "price target", "undervalued", "overvalued", etc.
   - Returns `(passed, reason_if_failed)`

   **Headline generation** (deterministic, no LLM):
   - `generate_ta_headline(facts: dict, events: list) -> str` — first fired event label, else key metric summary, else `"Data unavailable"`
   - `generate_fa_headline(metrics: list) -> str` — most compelling non-null metric, else `"Data unavailable"`

   **Prompt assembly** (per spec appendix §§ Prompt Templates):
   - `build_ta_messages(symbol, timeframe, facts, events) -> list[Message]` — system + user template (facts JSON inline, event labels as anchors)
   - `build_fa_messages(symbol, period, metrics) -> list[Message]` — system + user template (metrics JSON inline)
   - Both include `[step:narrate]` marker for `FakeLLMClient` recognition

   **The two handlers** — `_handle_technical_job(...)` and `_handle_fundamental_job(...)`:
   - Validate envelope → fetch reference from backend → check facts not empty (terminal failure if empty)
   - Assemble fact/metric JSON
   - Call LLM with `CostTracker($0.10 ceiling)`:
     1. Initial call → parse `{"narrative": "..."}` JSON
     2. Check grounding → if violation, treat as malformed (don't immediately fail; go to corrective)
     3. Corrective retry: echo bad reply (≤2000 chars) + corrective instruction
     4. Parse + check grounding again
     5. Still bad → strip narrative to `"Narrative withheld: failed the grounding check."` + headline `"facts-only: Grounding check failed."` (not terminal)
     6. `CostCeilingExceeded` → same strip path (not terminal, artifact still written)
   - Build artifact (facts, events/metrics, narrative, provenance, cost)
   - Pre-write Pydantic validation → claim-check to S3 → return `JobResult`

3. **Modify `handler.py`**:
   - Import handlers from `ta_fa_analysis`
   - Replace `_handle_analysis_job(...)` with:
     ```python
     if job_name == JOB_ANALYZE_TECHNICAL:
         return _handle_technical_job(raw_envelope, artifact_store, report_progress, backend_client)
     if job_name == JOB_ANALYZE_FUNDAMENTAL:
         return _handle_fundamental_job(raw_envelope, artifact_store, report_progress, backend_client)
     ```
   - Update `handle_job` docstring: "TA/FA now call backend_client for reference reads"
   - Keep `graph.py` import but stop calling `run_analysis` in the live path
   - Add comment above old `_handle_analysis_job`: `# NOTE: stub kept for reference; replaced by ta_fa_analysis. See graph.py.`

4. **Unit tests** — New `tests/test_ta_fa_analysis.py`:
   - Happy path TA: valid `JobResult`, correct `jobId = "technical:{symbol}:1D:{bucket}"`, artifact S3 write, `cost` block populated, `narrative.text` non-empty
   - Happy path FA: same for FA with `"fundamental:{symbol}:quarterly:{bucket}"` format
   - Progress sequence: 0→5 monotonic, phases match spec exactly (TA: queued → fetching-market-data → computing-indicators → synthesizing-verdict → persisting-artifact → done)
   - Bad envelope → `TerminalJobError`
   - 404 reference → `TerminalJobError`
   - Empty facts → `TerminalJobError`
   - Malformed LLM output → corrective retry → still malformed → `TerminalJobError`
   - Grounding violation (ban word on both attempts) → artifact written with `"facts-only: Grounding check failed."` headline, cost populated, not terminal
   - Cost ceiling hit → artifact written with `"facts-only: Narration stopped by cost guard."` headline, not terminal
   - Pre-write validation failure → `TerminalJobError`
   - Uses `FakeBackendClient.get_analysis_reference()` returning canned response matching spec contract

5. **Update `test_handler.py`**:
   - Add `get_analysis_reference(symbol: str) -> dict` to `_UnusedBackendClient` (raises `AssertionError`)
   - Move `test_technical_job_returns_valid_result` / `test_fundamental_job_returns_valid_result` to use `FakeBackendClient` (already exists in file; extend it to return reference responses)

6. **Extend `llm/fake.py`**:
   - Add `"narrate"` to `_CANNED` dict: `{"narrative": "Fake: price above all SMAs with RSI at mid-band."}`
   - Update step detection to handle `[step:narrate]` marker (consistent with prospectus pattern)

### Failure classes (ADR-0007 §6)

**Terminal** (TerminalJobError → BullMQ UnrecoverableError):
- Bad envelope (ValidationError)
- Unknown symbol / 404 reference → httpx.HTTPStatusError 404
- Malformed reference response (ValidationError)
- Empty facts
- Malformed LLM output after corrective retry
- Grounding violation after corrective retry (both attempts still violated)
- Pre-write artifact validation failure

**Transient** (BullMQ retries):
- Backend 5xx (reference fetch)
- LLM timeout / rate-limit / 5xx
- Network blips

**Not terminal, artifact written**:
- `CostCeilingExceeded` → strip narrative, emit `facts-only:` headline
- Grounding violation on first attempt (corrective retry succeeds)

### Testing strategy

- Unit: `test_ta_fa_analysis.py` (no live infra; `FakeBackendClient`, `FakeLLMClient`, `FakeS3`)
- Validation: run against existing fixtures (`technical-job-envelope.json`, `fundamental-job-envelope.json`, golden artifacts)

### Acceptance criteria

✓ Both handlers validate envelope
✓ Both fetch facts from backend reference endpoint
✓ Empty facts → terminal failure
✓ LLM narration with corrective retry works
✓ Grounding check (numbers + bans) implemented
✓ Cost tracking with $0.10 ceiling enforced
✓ Grounding/cost violations strip to facts-only, not terminal
✓ jobId colon forms minted correctly
✓ Progress sequence matches spec (6 steps, locked phases)
✓ Artifacts validate against contract (Pydantic)
✓ All unit tests pass
✓ Existing `test_handler.py` TA/FA tests pass with updated `FakeBackendClient`

### Related

- Consumer: BE `technical-analysis.store.ts` + `fundamental-analysis.store.ts` (hook reads jobId, headline)
- Spec: `.scratch/poc-phase-a-worker/spec.md` — full implementation details
- ADR-0007 (job/result/progress contract), ADR-0011 (runtime conformance), ADR-0014 (artifact validation)
