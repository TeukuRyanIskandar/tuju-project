# 05 — Prove artifact timestamps against the real contracts

Type: task
Status: ready-for-agent
Blocked by: 01
Severity: high
Component: `services/ai`

## Problem

The fix for the production timestamp defect appears to exist in the working tree,
but the regression that proves it does not test the thing that actually broke.
Ticket 14's acceptance criterion — "Stored/proxied TA/FA artifact timestamps pass
**actual** contracts with a regression covering the validated model-to-S3
boundary" — is therefore not met.

## Evidence

The defect, from `../../readiness.md:74-88`:
`GET /stocks/5326/analysis/technical/artifact` is HTTP 200 but fails
`TechnicalAnalysisArtifact.omit({ cost: true })` on:

- `asOf`: `2026-10-15 04:25:29.756000+00:00`
- `provenance.generatedAt`: `2026-10-15 06:45:32.611010+00:00`

Both encode the correct instant as a space-separated datetime rather than ISO
8601. Reproduced on two further reads at `06:57:19Z`. Cost omission is
intentional at the proxy (`apps/backend/src/analysis/stock-analysis-envelope.ts`)
and is not part of the defect.

The likely mechanism: `services/ai/src/tuju_ai/artifacts.py:46` serialized with
`json.dumps(..., default=str)`, which stringifies a Python `datetime` via
`str()` — producing exactly the space-separated form above.

The fix already in the working tree, in
`services/ai/src/tuju_ai/jobs/pipeline.py`:

```python
validated = definition.artifact_contract.model_validate(output.artifact)
artifact = validated.model_dump(mode="json", by_alias=True, exclude_unset=True)
pointer = deps.artifact_store.put_artifact(output.artifact_key, artifact)
```

`mode="json"` is what converts a `datetime` to an ISO string.

**The gap:** the added regression in `services/ai/tests/test_job_pipeline.py`
defines a local `class Nested(BaseModel)` / `class WireArtifact(BaseModel)` and
asserts against those. It proves the serialization *mechanism*. It never touches
the generated `TechnicalAnalysisArtifact` or `FundamentalAnalysisArtifact`, which
are the models whose `z.iso.datetime({ offset: true })` fields rejected the real
payload — nor the browser `omit({ cost: true })` shape the frontend actually
validates against.

## Root cause

The old serialization path bypassed the validated model, so a Python-native
`datetime` reached `json.dumps` and was stringified by `str()`. The fix routes
through the validated model's JSON mode. The regression just tests the wrong
model.

## Fix

1. Add a regression in `services/ai/tests/` that runs a **real** TA or FA
   artifact shape through the full `JobDefinition` -> `put_artifact` -> read-stored-
   bytes path, using the generated `TechnicalAnalysisArtifact` as the
   `artifact_contract`.
2. Assert the stored bytes satisfy **both**:
   - the generated Pydantic model, and
   - the browser schema with cost stripped, matching
     `packages/contracts/src/http/stocks.ts:178-181`.
   That second assertion is the one the live failure proved necessary.
3. Assert the two ISO fields explicitly — `asOf` and
   `provenance.generatedAt` — so a regression names the failing field.
4. Assert `exclude_unset=True` did **not** drop explicitly supplied nulls. FA
   metrics are null by design, and `model_dump` defaults are a classic way to
   lose them. This is the risk the new serialization call introduces.
5. Keep the existing toy-model test. It is a fast, readable test of the
   mechanism; the new one is the contract test. They test different things.
6. Run **after** [01](01-contract-percent-scale.md) so the assertion covers the
   final regenerated models rather than shapes that are about to change.

## Acceptance criteria

- A stored artifact round-trips through the real generated models and the
  cost-stripped browser schema with no timestamp coercion.
- The regression would fail against the pre-fix serialization path.
- Explicit nulls survive serialization.
- The test names the offending field when it fails.

## Verification

```bash
# services/ai pytest configuration
pytest services/ai/tests/            # full AI suite
```

Prove the regression bites by temporarily reverting `pipeline.py` to the
`output.artifact` call and confirming the new test fails. Do not leave the
revert in place.

## Limits

- This ticket proves the **model-to-store boundary**. It cannot prove the proxy
  or the browser. There is no live backend here, and
  [09](09-bounded-rerun-readiness-reaudit.md) owns the end-to-end re-audit.
- A second serialization path may exist for other artifact types. Check whether
  `artifacts.py` is reached by any other writer; if it is, cover it here or file
  a follow-up rather than leaving it unexamined.
- Do not relax the ISO contracts to accommodate stored bad data. The existing
  artifact written at `06:45` stays invalid; regenerate rather than migrate it.