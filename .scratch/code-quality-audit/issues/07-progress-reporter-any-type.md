# M-02: ProgressReporter typed as Any in ta_fa_analysis.py

**Severity:** Major  
**Status:** completed  
**Component:** `services/ai` (Python worker)

## Verified ✅

Code review of `services/ai/src/tuju_ai/ta_fa_analysis.py` confirms `ProgressReporter` is now properly typed as `Callable[[JobProgress], None]` (not `Any`). The type definition matches `handler.py:80` and async-to-sync bridging via `sync_report` is now type-safe. mypy passes without type erasure warnings.

## Problem

`ta_fa_analysis.py:43` declares:

```python
ProgressReporter = Any
```

But `handler.py:80` defines:

```python
ProgressReporter = Callable[[JobProgress], None]
```

### Consequences

1. **Type erasure:** mypy/pyright cannot verify that a callback passed to TA/FA functions has the correct signature.
2. **Silent mismatches:** If the injected progress callback has the wrong signature (e.g., `async def report(progress)` instead of sync), mypy won't catch it.
3. **Runtime fragility:** The `sync_report` wrapper in `worker.py` bridges async-to-sync. Any error in that bridging is invisible to the type system.

## Fix

Use the same type alias in `ta_fa_analysis.py`:

```python
from typing import Callable
from tuju_ai.contracts_generated.models import JobProgress

ProgressReporter = Callable[[JobProgress], None]
```

Then verify mypy/pyright passes:

```bash
mypy services/ai/src
```

## Files Affected

- `services/ai/src/tuju_ai/ta_fa_analysis.py:43` (remove `Any`, import correct type)
- `services/ai/src/tuju_ai/handler.py:80` (reference type for consistency)
- `services/ai/src/tuju_ai/worker.py` (verify sync_report call site)

## Testing Opportunity

Add a mypy strict test to the CI pipeline to catch future type erasure.

---
