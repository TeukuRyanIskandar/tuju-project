# Decide: OpenRouter narration rules

Type: grilling
Status: resolved
Blocked by: 03

## Question

Pin how the LLM narrates TA/FA facts for the PoC: provider, model, language,
grounding, failure behaviour, and cost posture. User: OpenRouter now; API key
later; free models OK.

## Answer

**OpenRouter only; facts in → grounded BM narrative out; fail closed.**

### Provider / model

- Client: existing [`OpenRouterClient`](../../../services/ai/src/tuju_ai/llm/openrouter.py).
- Default model: keep worker default **`google/gemini-2.5-flash`** via
  `LLM_MODEL` (already OpenRouter-routed). Operators may point at an OpenRouter
  free-route model id without code changes.
- `OPENROUTER_API_KEY` required for TA/FA jobs; if unset → **terminal** failure
  (same posture as prospectus), clear userMessage.

### Language / tone (differentiator vs TTW)

- **Primary:** Bahasa Malaysia plain language for `narrative.text`.
- **Secondary:** English narrative optional via flag later; PoC ships BM.
- Tone: descriptive market commentary for retail; short (≈80–150 words).
- Hard bans in system prompt: buy/sell/hold, price targets, “guaranteed”,
  “undervalued/overvalued” as advice, “should enter/exit”.

### Grounding (accuracy claim for the panel)

1. Worker builds the **facts/events/metrics** JSON first (code only).
2. Prompt includes that JSON as the **only** numeric source.
3. Model instructed: every number in the narrative must appear in the facts
   payload; if it cannot narrate without inventing, return a fixed refusal
   token / empty narrative.
4. **Post-check (worker):** extract numbers from narrative; if any number is not
   in the facts payload (string/number match with light normalisation), discard
   narrative and surface facts-only card + warning headline.
5. If facts payload is empty → do not call LLM; persist facts-only failure/
   skip narrative.

This is the PoC answer to “how accurate is your system?”: **indicators/metrics
are 100% code-verifiable; LLM is cosmetic language over those facts.**

### Cost / rate

- Bound by system cadence: ≤60 successfully billed calls per nightly run
  (30×2), plus ops re-runs.
- Soft per-job ceiling: reuse prospectus-style cost guard idea at a **lower**
  cap (worker spec pins exact USD; order of magnitude cents, not dollars).
- Retries: transient OpenRouter errors retry per JobBus policy; grounding
  failure is **terminal for narrative** (facts still stored).

### Deferred to worker spec

- Exact prompt text, golden fixtures, model A/B, prompt caching flags.
