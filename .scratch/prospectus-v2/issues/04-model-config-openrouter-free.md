# Build ticket: Model config — openrouter/free + live validation

Type: task
Status: resolved
Blocked by: 03 (Docker image split; clean state before live runs)

> Ticket 04 of prospectus-v2. Switch the default LLM model from `google/gemini-2.5-flash` (paid, requires credits) to `openrouter/free` (free tier router). Validate end-to-end pipeline on all 3 corpus PDFs with live model. Record timing and quality metrics.

## What to build

- **`services/ai/src/tuju_ai/config.py`**:
  - Change `DEFAULT_LLM_MODEL = "google/gemini-2.5-flash"` → `"openrouter/free"`
  - Add env var `LLM_MODEL_OVERRIDE` (optional): allows tests or manual runs to override without changing the config default

- **`services/ai/src/tuju_ai/llm/cost.py`**:
  - Add `"openrouter/free": ModelPrice(input=0.0, output=0.0, cached_input=0.0)` to `DEFAULT_PRICE_TABLE`
  - This makes the cost guard **logically inert** (all pre-call worst-case estimates return $0, ceiling never breached, actual spend always $0)
  - Document in the module docstring: "Free models have zero cost; the guard remains in place for consistency but does not enforce a ceiling"

- **`services/ai/src/tuju_ai/llm/openrouter.py`** — no changes needed:
  - The client already extracts `model` from the response: `model=str(data.get("model") or self.model)`
  - When using `openrouter/free`, the response will include the actual model dispatched by the router (e.g. `google/gemma-4-31b-it` or `nvidia/nemotron-3-ultra-550b-a55b:free`)
  - This is automatically logged in the artifact's `provenance.model` field

- **Live validation run** (manual, requires `OPENROUTER_API_KEY`):
  - Set up local environment: `OPENROUTER_API_KEY=<your-key>` (real key, not test/fake)
  - Run the full 3-PDF corpus pipeline against the local services (or prod if available):
    ```bash
    docker-compose up -d redis postgres localstack ai-worker ai-parse-worker
    # Wait for services to boot
    pytest tests/prospectus/test_analysis.py::test_corpus_* -m corpus -v -s --tb=short
    ```
  - For each PDF, record:
    - Actual model selected (from artifact `provenance.model`)
    - Per-step latency (from logs or `CostTracker.calls` report)
    - Total end-to-end wall-clock time
    - Quality spot-check: verify `FinancialsOutput.periods` has entries, `RiskOutput.themes` has entries, `WatchOutput.headline` is not empty
  - Capture the run in a markdown table in `.scratch/prospectus-v2/live-run-results.md`

- **Integration test with live API** (add to `tests/prospectus/test_analysis.py`):
  - `test_live_openrouter_free_model_routing` (marked with `@pytest.mark.live` to skip by default):
    - Call OpenRouter with `openrouter/free` model ID, make a simple structured-output request
    - Assert response includes `model` field with the actual model selected
    - Log which model was routed for debugging

- **Quality baseline** (to compare against in T05):
  - Record the artifact JSON for each of the 3 PDFs
  - If quality is unacceptable (e.g. empty `periods` list, malformed `themes`), document in ticket as a blocker for T05

## Acceptance criteria

- [x] `DEFAULT_LLM_MODEL` changed to `"openrouter/free"`
- [x] `"openrouter/free"` added to cost pricing table with $0 rates
- [x] Live test: all 3 corpus PDFs produce valid `ProspectusArtifact` without errors
- [x] `provenance.model` in each artifact shows the actual routed model (not `openrouter/free`)
- [x] `cost.estimatedCostUsd` reports `0.0` for all 3 runs
- [x] Wall-clock timing recorded for each PDF (Phase A, Phase B, LLM calls, total)
- [x] Quality spot-check: `FinancialsOutput.periods` non-empty, `RiskOutput.themes` non-empty, `WatchOutput.headline` non-empty on all 3 PDFs
- [x] Live-run results table saved to `.scratch/prospectus-v2/live-run-results.md`

## Out of scope

- A/B testing with paid models (can be done as a follow-up; focus is on validating free tier works)
- Model fallback logic (if quality is bad, escalate; don't auto-retry)

## Implementation notes

- `openrouter/free` has a **200K token context limit** (documented on their API page). The current `SECTION_CHAR_BUDGET = 240_000 chars ≈ 80K tokens` fits comfortably.
- Free tier models have **rate limits**: typically 200–500 req/day per IP. For 3 PDFs × 8 LLM calls = 24 calls, we're safe. For larger corpus, consider spacing out runs or requesting higher limits.
- The router selects model **at request time**, so identical inputs may route to different models on retry. This is expected and acceptable — test for outcome correctness, not model determinism.
- Free models may have higher latency than paid (shared resources). Expected ~5–15 sec per call (vs. ~2–5 sec for Flash).
- Log the `X-OpenRouter-Model` response header (if present) for debugging which model was selected.

## Testing strategy

- Unit tests: mock the OpenRouter client, verify cost calculation returns $0
- Integration tests: live OpenRouter call if `OPENROUTER_API_KEY` is set, else skip
- Corpus tests: marked `@pytest.mark.live`, skipped unless explicitly requested

## Artifacts to produce

- `.scratch/prospectus-v2/live-run-results.md`: table of timings, models routed, quality checks for each PDF
- `.scratch/prospectus-v2/artifacts/` (optional): save the full artifact JSONs for manual inspection

## Answer

Code done:

- `DEFAULT_LLM_MODEL="openrouter/free"`, also in `.env.example`, compose and the README.
- `openrouter/free` and any `…:free` model are priced at $0.
- `CostTracker` records the model that answered each call (`ProspectusCostCall.model`, optional contract field).
- `provenance.model` lists the distinct answering models.
- Tests are in `test_prospectus_analysis.py`.
- `LLM_MODEL_OVERRIDE` was not added: the existing `LLM_MODEL` env var already does this.

**Remaining (needs a real key):** run `OPENROUTER_API_KEY=... uv run --project services/ai python scripts/live_corpus_run.py` from the repo root. It writes `live-run-results.md` and `artifacts/` here. The script was dry-run end to end with the fake client.

### Live run 1 (2026-10-12, Part 1 only)

Results are in [`../live-run-results.md`](../live-run-results.md).

- **Fibromat:** passed in 217 s (parse 1.1 s), $0, 8 calls answered by 5 different free models.
- **IAB and LSH:** failed at `lockup` with `MalformedModelOutput` after the one bounded retry. One reply was empty and the other was truncated JSON.

The router's model variance breaks JSON reliability about half the time per document.

**Decision (user, 2026-10-12):** more retries at $0. When the tracker's model is priced at $0, the bound is `MAX_RETRIES_FREE = 3`. Paid models keep `MAX_RETRIES = 1`. Tests are in `test_prospectus_analysis.py` and the change is recorded in ADR-0015.

### Live run 2 (2026-10-12, full merged corpus, free retries)

All 3 passed. Results are in [`../live-run-results.md`](../live-run-results.md) and artifacts in `../artifacts/`.

| Prospectus | Parts | Parse | LLM | Calls | Cost | Routing |
|---|---|---|---|---|---|---|
| Fibromat | 3 | 3.1 s | 227 s | 9 | $0 | 6/6 located |
| IAB | 4 | 5.1 s | 197 s | 9 | $0 | 6/6 located |
| LSH | 3 | 4.7 s | 197 s | 8 | $0 | 6/6 located |

- **Retries:** two documents needed one malformed-reply retry each (9 calls against a baseline of 8).
- **Models:** 5 to 6 distinct free models answered each document.
- **Spot-check:**
  - Lock-up holders and durations are real: 3, 4 and 12 entries.
  - Related-party is populated for IAB and LSH.
  - Fibromat states "no material RPTs" (`present: false` with a summary).
  - Headlines are grounded.
- **Total time** is about 3.5 min per document, dominated by sequential LLM calls. Parse takes 3 to 5 s.
