# 05 — Prove artifact timestamps against the real contracts

Type: task
Status: resolved
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

## Resolution

Resolved 2026-10-16. **The Problem section was already out of date when this
ticket was written:** `c181bd2` (ticket 03) had landed the real-model
regression the ticket asks for. What was genuinely missing was one assertion
and the proof that the regression bites.

### What was already landed

| Ticket requirement | Where |
| --- | --- |
| Real TA/FA artifact through `JobDefinition` → `put_artifact` → read stored bytes | `services/ai/tests/test_ta_fa_analysis.py:276`, committed in `c181bd2` |
| Stored bytes satisfy the generated Pydantic model | same test, via the Vitest handoff at `packages/contracts/test/fixtures.test.ts:44` |
| `asOf` and `provenance.generatedAt` named explicitly | `test_ta_fa_analysis.py:358-359`; `fixtures.test.ts:46-52` |
| Explicit nulls survive `exclude_unset=True` | `test_ta_fa_analysis.py:361`; `fixtures.test.ts:53-55` |
| Toy-model test kept as the fast mechanism check | `test_job_pipeline.py:224` |

### What this ticket added

The missing half: captured **stored** bytes were never validated against the
cost-stripped browser schema. `browser-artifacts.test.ts` checks that shape
against golden fixtures only, so nothing proved the two shapes agree on the
artifact the pipeline actually wrote — which is the half the live 200-but-fails
failure proved necessary.

`fixtures.test.ts:37` now carries a fourth tuple element, the `browser` schema
(`null` for prospectus, which keeps `cost`), and `fixtures.test.ts:90-121`
asserts, for TA and FA:

- the stored body **minus** `cost` parses to itself —
  `expect(browser.parse(body)).toEqual(body)`. Identity, not a `Date`, so a
  coercing schema fails the equality.
- the un-stripped stored bytes are **rejected**, so this assertion is not
  redundant with the stored-schema one above it.
- `asOf` and `provenance.generatedAt` equal the expected ISO literals, naming
  the offending field.
- the old space-separated controls are rejected with the same two
  `invalid_format` paths, plus the per-timestamp single-failure controls —
  cost-stripped, because leaving `cost` in would fail on the extra key and
  prove nothing about the timestamps.

### Revert check

`jobs/pipeline.py` temporarily restored to
`put_artifact(output.artifact_key, output.artifact)`:

| Regression | Result against the pre-fix path |
| --- | --- |
| `test_ta_fa_captured_timestamp_bytes_against_source_ts_contracts` | **fails** — `test_ta_fa_analysis.py:324` (`validated[0] is not artifact`) |
| `test_contract_serialization_uses_aliases_omits_unset_and_keeps_explicit_nulls` | **fails** — `'2026-10-08 18:02:03.123456+08:00'` |
| `test_prospectus_final_bytes_against_source_ts_contract` | **passes — correct, see below** |

`pipeline.py` was then restored, sha256 verified identical to the pre-check
copy.

### The prospectus regression cannot bite, and that is correct

`test_prospectus_final_bytes_against_source_ts_contract` passes against the
pre-fix path because `prospectus/analysis.py:471` already writes
`deps.now().isoformat()`. The only datetime-typed field in the whole prospectus
artifact is `ProspectusProvenance.generatedAt` (generated model line 203), so
no raw `datetime` ever reached `json.dumps(default=str)` there. **The
prospectus path never had this defect.** The test is kept as a conformance
guard — it proves the prospectus artifact passes the real TS contract and pins
the `timing` shape — but it is *not* evidence for the fix, and this ticket does
not claim it as such.

For the record, the TA/FA mechanism is narrower than "any datetime": only
`asOf` and `provenance.generatedAt` were ever affected. `TechnicalEvent.at` and
`FundamentalMetric.asOf` arrive from the backend reference as strings
(`ta_fa_analysis.py:308`, `:404`), so `default=str` was a no-op on them. The
two that broke are the ones written as native values —
`"asOf": envelope.asOf` (`ta_fa_analysis.py:328`, `:424`) and
`provenance.generatedAt`.

### Second serialization path: examined, safe

`put_artifact` has exactly two callers:

- `jobs/pipeline.py:289` — the path this ticket fixes.
- `prospectus/store.py:52` — parse-cache persistence, already
  `parse.model_dump(mode="json")` on `ProspectusParse`, an internal parse
  record that is never proxied to a browser.

No third writer, and no unexamined path.

### Deviations from the ticket as written

- **No Python change was needed.** The existing subprocess handoff
  (`test_ta_fa_analysis.py:372`) already hands the real stored bytes to Vitest
  and always sets the capture env var, so the new assertions run in the same
  pass. The toy-model test was already correct and is kept as written.
- **Proven by mutation as well as by revert.** A deliberately wrong expected
  `generatedAt` failed both TA and FA, confirming the new block is reached
  rather than silently skipped by the `if (browser)` guard. A first draft of
  the per-timestamp control seeded from the already-broken body and produced
  2 issues instead of 1; caught by the run, fixed to mirror the stored-schema
  control's pattern.

### Recorded limits

- **The live proxy and browser remain unproven.** This ticket covers the
  model-to-store boundary plus the source TS schemas it can execute.
  [09](09-bounded-rerun-readiness-reaudit.md) owns the end-to-end re-audit.
- **The `06:45` artifact stays invalid.** No ISO contract was relaxed; that
  stored artifact is regenerated, never migrated.
- **Unrelated, observed and not fixed:** `pytest.mark.unit` and
  `.integration` are not registered in the AI pytest config, so every marked
  module emits `PytestUnknownMarkWarning` (alongside pre-existing PyMuPDF SWIG
  deprecations). Pre-existing, and out of scope for this ticket.

### Verification

```bash
pnpm --filter contracts check    # OK — no contract drift
pnpm --filter contracts test     # 4 files, 74 passed, 3 skipped (the opt-in captures)
uv run --project services/ai pytest    # 227 passed — matches the pre-ticket baseline
```

The 3 skips are the opt-in captured-bytes tests, which skip when their env var
is unset. They do run, and are exercised, under the AI suite's two capture
tests.