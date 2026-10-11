# M-03: Dead deprecated _handle_analysis_job still present and callable

**Severity:** Major  
**Status:** completed  
**Component:** `services/ai` (Python worker)

## Verified ✅

Code review of `services/ai/src/tuju_ai/handler.py` confirms the deprecated `_handle_analysis_job` function has been removed. The only active entry point is `handle_job` at line 97, which routes technical/fundamental analysis to the new `ta_fa_analysis.py` module. No dead code path remains.

## Problem

`handler.py:144–212` contains a deprecated TA/FA handler marked for deletion:

```python
def _handle_analysis_job(envelope: JobEnvelope) -> JobResult:
    """DEPRECATED: TA/FA stub kept for reference; replaced by ta_fa_analysis"""
```

The function is not called by the current job dispatcher (`handle_job` at line 97 routes to `ta_fa_analysis.py` instead), but it is still present as a top-level function and could be reached if:

1. A code path regression accidentally routes to it
2. A developer manually invokes it during debugging
3. An old queued job references this handler name

### Consequences

1. **Confusion:** Developers may not know which handler is authoritative (deprecated vs new).
2. **Maintenance burden:** Any schema change requires updating both the old stub and the new handler.
3. **Subtle bug vector:** The old function uses the stale `run_analysis` graph and returns `SystemSummary` (no verdict), which is incompatible with the `AnalysisResultStore.persist` filter that skips non-verdict results.

## Fix

**Delete the entire function** (`handler.py:144–212`). The current path via `ta_fa_analysis.py` is the only active path; the stub is not needed as a reference.

If historical reference is needed, consult git history (`git log -p -- handler.py`).

## Files Affected

- `services/ai/src/tuju_ai/handler.py:144–212` (delete function)

## Testing Opportunity

Add a test: `test_handle_job_routes_ta_to_ta_fa_analysis()` to verify that a technical job is dispatched to the new handler, not the old one. This will fail if someone accidentally re-enables the old path.

---
