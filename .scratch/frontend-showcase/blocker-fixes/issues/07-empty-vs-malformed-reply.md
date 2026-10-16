# 07 — Distinguish an empty reply from a malformed reply

Type: task
Status: resolved
Blocked by: 06
Severity: medium
Component: `services/ai`

## Problem

An empty model reply and a wrongly-shaped model reply currently produce the same
terminal error text. The terminal reason misdescribes what happened, which is why
the last investigation could not establish a cause.

## Evidence

`services/ai/src/tuju_ai/llm/structured.py` funnels both through one path:

- `extract_json("")` (`:58-71`) raises `JSONDecodeError` -> caught at `:104` as
  `MalformedModelOutput(_first_line(exc))`.
- `extract_json('{"narrative": 123}')` raises `ValidationError` -> caught at the
  same line, same class.

The rendered message at `:120-124` reports only the Python exception's first
line, so `Expecting value: line 1 column 1 (char 0)` is indistinguishable between
"the model returned nothing" and "the model returned prose we could not find a
JSON object in".

`services/ai/src/tuju_ai/ta_fa_analysis.py:80-83` only catches
`CostCeilingExceeded` and `OutputRejected`, so `MalformedModelOutput` propagates
as terminal — correct, but with a terminal reason that does not help anyone
diagnose it.

## Root cause

Three distinct failure modes — empty reply, unparseable reply, schema-invalid
reply — are collapsed into one exception type and one message template.

## Fix

1. In `structured.py`, classify before formatting:
   - **empty** — `response.text` is empty or whitespace only
   - **unparseable** — non-empty text, no JSON object found
   - **invalid** — parsed, but pydantic rejected the shape
2. Give each a distinct terminal reason naming the failure and, using the
   metadata from [06](06-openrouter-response-diagnostics.md), the response
   facts: `finish_reason`, completion tokens, empty-content flag, reasoning
   present.
3. Keep `MalformedModelOutput` / `OutputRejected` semantics for `narrate`'s
   except-clauses at `ta_fa_analysis.py:80-83` intact. **An empty reply must
   stay terminal** — it must not be routed into the facts-only degrade, which
   would silently mask a provider fault as a grounding outcome.
4. Offline tests for each of the three classes, including the empty-with-
   `finish_reason: "length"` case.

## Acceptance criteria

- Each of the three failure modes produces a distinct, accurate terminal reason.
- The empty-reply reason states that the model returned nothing, rather than
  implying a shape problem.
- Facts-only is not triggered by an empty reply.
- Retry count and cost accounting are unchanged.

## Verification

```bash
# services/ai pytest configuration
pytest services/ai/tests/
```

Confirm the facts-only path is unchanged: `test_ta_fa_analysis.py` cases for
grounding and cost-guard degrade must still pass and still assert the exact
placeholder strings, since
`apps/frontend/src/components/stocks/analysis-presentation.ts:29-33` matches
those strings byte for byte. Changing a placeholder here silently breaks the
frontend's facts-only suppression.

## Limits

- Diagnostic only. It makes the next failure legible; it does not prevent one.
- Do not add a fallback narrative. The placeholder set at
  `ta_fa_analysis.py:42-49` is contract-adjacent on the frontend side.
- If [08](08-narration-empty-content-remedy.md) resolves to `wontfix`, this
  ticket still stands on its own: an accurate terminal reason is worth having
  regardless.

## Answer

`llm.structured.ask` now distinguishes whitespace-only replies, non-empty
unparseable replies, and parsed schema-invalid replies before retry formatting.
Each terminal reason includes only the ticket-06 allowlisted response facts:
finish reason, completion tokens, content-empty flag and reasoning-present
flag. All remain `MalformedModelOutput`, so the existing pipeline terminal path
and retry/cost accounting are unchanged; only `OutputRejected` still reaches
the TA/FA facts-only degrade.

Offline regressions cover all three classes, including an empty reply with
`finish_reason="length"`; TA and FA coverage proves empty narration remains
terminal rather than writing a facts-only artifact. `uv run --project
services/ai pytest` passed: 246 tests. The suite emitted 25 pre-existing
third-party/pytest-marker warnings.
