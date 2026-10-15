# One LLM runtime + structured-call module

Status: resolved
Strength: Strong
Dependency category: ports & adapters (LLMClient: OpenRouterClient + FakeLLMClient)
Blocked by: 07

## Files
- `services/ai/src/tuju_ai/ta_fa_analysis.py` (`_get_llm_client` ~276–290, `_narrate_with_grounding_retry`, `check_grounding`, `_extract_numbers`, `BAN_WORDS`, `ceiling_usd=0.10` at 432/565)
- `prospectus/analysis.py` (`_complete_validated`, `extract_json`), `prospectus/job.py` (`ProspectusRuntime`)
- `llm/cost.py`, `worker.py`, `config.py`, `tests/conftest.py`

## Problem
There are two corrective-retry loops, and they disagree on JSON tolerance, retries, grounding and cost behaviour. TA/FA skip the configured runtime (`os.environ`, a hardcoded ceiling, the `test-key-for-testing` branch). An autouse conftest monkeypatches a private function and leaks env. `response` can be unbound in the TA/FA except branch.

## Direction
- `LLMRuntime` (client, price table, per-job-kind ceilings, prompt cache) is built once from Settings in `worker.run()` and injected.
- `llm/structured.ask(runtime, step, messages, schema, validators=[...])` owns JSON extraction, retry/echo, the validator chain and cost.
- Grounding and no-advice become validators.
- Delete `ProspectusRuntime` (folded in) and the test-key branch.
- Keep current behaviour: TA/FA degrade to facts-only on cost or grounding exhaustion; prospectus is terminal.

## Tests
`ask()` with Fake garbage replies covers retry count, echo, grounding rejection and the ceiling. No autouse monkeypatching and no env mutation.

## Comments

Resolved 2026-10-12 (uncommitted, on `refactor/architecture-deepening`).

- New `llm/runtime.py`: `LLMRuntime(client, ceilings_usd, price_table)` with
  `from_settings(settings)` and `session(job_name) -> LLMSession` (client + a
  fresh `CostTracker` at that job kind's ceiling). No client ⇒ `LLMConfigError`
  naming the job. Built once in `worker.run()` and injected via `handle_job(llm=...)`.
- New `llm/structured.py`: `ask(session, step, messages, schema, *, max_tokens,
  validators=())` owns `extract_json`, schema validation, the validator chain,
  the echo-and-retry (original prefix + capped echo), the retry bound (1 paid /
  3 free) and metering. Exhaustion raises `MalformedModelOutput` or
  `OutputRejected` (both `StructuredCallFailed`); `CostCeilingExceeded`
  propagates.
- New `llm/grounding.py`: `ungrounded_number(text, *sources)` and
  `advice_term(text)` (same algorithm and ban list as before), used as `ask`
  validators by TA/FA narration.
- `ProspectusRuntime`, `build_prospectus_runtime`, `_get_llm_client` (with the
  `test-key-for-testing` branch), `_narrate_with_grounding_retry` (the unbound
  `response`), `_complete_validated` and the autouse `conftest.py` are deleted.
- New setting `narration_cost_ceiling_usd` (`LLM_NARRATION_COST_CEILING_USD`,
  default 0.10) replaces the hardcoded TA/FA ceiling. TA/FA now honour
  `LLM_MODEL` defaulting like the prospectus job (no `LLM_MODEL` requirement).
- Behaviour fix (matches poc-phase-a-worker tickets 04/05 and the backend hook's
  own spec): grounding/no-advice exhaustion now degrades TA/FA to facts-only
  (`facts-only: Grounding check failed.`, narrative `Narrative withheld: failed
  the grounding check.`). Before, it was terminal. A reply that never parses is
  still terminal. TA/FA on a $0 model now get the shared free-model retry bound (3).
- `tuju-ai-smoke` was broken at baseline (missing `backend_client`); fixed with
  a canned backend + `FakeLLMClient`.
- Tests: new `test_llm_structured.py` (ask retry/echo/bound, validators,
  ceiling, runtime). TA/FA tests inject `FakeLLMClient` through `LLMRuntime`.
  Unit lane 175 → 189 passed; integration 2 passed; smoke OK.

