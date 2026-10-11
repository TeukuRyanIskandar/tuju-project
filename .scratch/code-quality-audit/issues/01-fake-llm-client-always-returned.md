# C-01: FakeLLMClient always returned — `_get_llm_client` passes no args to OpenRouterClient

**Severity:** Critical  
**Status:** completed  
**Component:** `services/ai` (Python worker)

## Problem

`_get_llm_client()` in `ta_fa_analysis.py:268–275` attempts to instantiate `OpenRouterClient()` with no arguments, but the constructor requires two required keyword-only arguments: `api_key` and `model`.

```python
def _get_llm_client() -> LLMClient:
    try:
        from .llm.openrouter import OpenRouterClient
        return OpenRouterClient()     # ← TypeError: missing 2 required arguments
    except Exception:                 # ← catches TypeError silently
        from .llm.fake import FakeLLMClient
        return FakeLLMClient()
```

### Consequences

1. **Silent fallback to fake:** The bare `except Exception` catches the `TypeError` and always returns `FakeLLMClient()`.
2. **Production fake narratives:** TA/FA jobs run with stub LLM responses, producing misleading analysis artifacts.
3. **No cost tracking:** Fake client returns `0.0` for cost, so real usage is invisible and not guarded by the cost ceiling.
4. **Broken intended design:** ADR-0007 §6 specifies "LLM integration as a cost-tracked paid feature"; this path bypasses it entirely.

## Root Cause

`OpenRouterClient.__init__` (in `llm/openrouter.py:46–48`) signature is:
```python
def __init__(self, *, api_key: str, model: str, ...)
```

Both `api_key` and `model` must be passed. The intended initialization appears to be missing — either the args should be pulled from environment variables inside the function, or passed from a config object.

## Fix

One of:
1. **Inject `api_key` and `model` from config:** Fetch from `os.environ` or an injected config inside `_get_llm_client`.
2. **Lazy init with proper error:** Return `None` and validate at call site.
3. **Wire via config object:** Pass a config object that contains both values.

The `FakeLLMClient` fallback should only be used in **tests**, not production. Consider a separate `_get_llm_client_for_testing()` path if testing is the intent.

## Files Affected

- `services/ai/src/tuju_ai/ta_fa_analysis.py:268–275` (the buggy function)
- `services/ai/src/tuju_ai/llm/openrouter.py:46–48` (the constructor spec)
- `services/ai/src/tuju_ai/handler.py` (calls `_handle_technical_job` / `_handle_fundamental_job`)

## Testing Opportunity

Add a test: `test_get_llm_client_returns_real_client_when_keys_present()` to verify the real client is instantiated (not fake) when `OPENROUTER_API_KEY` and model env vars are set.

---
