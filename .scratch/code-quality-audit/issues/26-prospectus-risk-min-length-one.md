# m-12: ProspectusRiskData.themes min_length=1 prevents empty risk list

**Severity:** Minor  
**Status:** needs-triage  
**Component:** `services/ai` (Python contracts, LLM output)

## Problem

`ProspectusRiskData.themes` is constrained with `min_length=1`, requiring at least one theme:

```python
# contracts_generated/models.py:447
themes: list[ProspectusRiskTheme] = Field(..., min_length=1)
```

The LLM prompt instructs "Return at most 7 themes" but says nothing about a minimum. If the LLM returns an empty list (indicating no risk factors — unlikely but possible given adversarial prompt injection), `model_validate` fails and triggers the corrective retry path, costing extra tokens.

### Consequences

1. **Wasted LLM cost:** A retry costs tokens but may not fix the underlying response (the LLM's "decision" to return 0 risks).
2. **Unnecessary complexity:** The retry logic adds latency when it's not required.

## Fix

Change the constraint to `min_length=0`:

```python
themes: list[ProspectusRiskTheme] = Field(..., min_length=0, max_length=7)
```

Then validate that at least one theme exists in the analysis logic (not in the schema):

```python
def _handle_prospectus(envelope: ProspectusJobEnvelope) -> JobResult:
    ...
    artifact = ProspectusArtifact(...)
    if len(artifact.risks.themes) == 0:
        # Log a warning, but don't fail
        logger.warning(f"No risks identified in prospectus {prospectus_id}")
    ...
```

## Context

The minimum constraint is appropriate for other fields like `sections` (should always have at least one section). But risks are a domain model where zero is valid (or at least should not cost tokens to retry).

## Files Affected

- `packages/contracts/src/prospectus-artifact.ts` (change Zod schema)
- `services/ai/src/tuju_ai/prospectus/analysis.py:400–410` (update codegen output)
- Add validation logic instead of schema constraint

---
