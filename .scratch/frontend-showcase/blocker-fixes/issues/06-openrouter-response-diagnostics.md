# 06 — Capture sanitized response metadata at the OpenRouter boundary

Type: task
Status: resolved
Blocked by: none
Severity: high
Component: `services/ai`

## Problem

The narration failure has no usable evidence because the transport layer
discards exactly the metadata that would explain it. Nine jobs failed with one
opaque terminal reason, and 52 HTTP 200 responses prove the provider was
answering.

## Evidence

`services/ai/src/tuju_ai/llm/openrouter.py:119-121`:

```python
data = resp.json()
choice = data["choices"][0]
text = choice["message"]["content"] or ""
```

This is the only place the raw provider response is available. It discards:

- `finish_reason` — distinguishes `stop` from `length`, and `length` would
  confirm token exhaustion.
- any `reasoning` / `reasoning_content` field — the OpenRouter-shaped slot where
  reasoning-tier models put their output when they do not emit `content`.
- the shape of an empty body.

`services/ai/src/tuju_ai/ta_fa_analysis.py:55` sets
`NARRATE_MAX_TOKENS = 300`, which is small. A reasoning-tier free model can
spend the whole budget before emitting any `content`, leaving `text` empty.

The observed terminal message is exactly what an empty reply produces
(`../../readiness.md:46-49`):

```
step 'narrate': the model's reply was still unusable after 3 retries
(Expecting value: line 1 column 1 (char 0))
```

`extract_json("")` -> `json.loads("")` raises `Expecting value: line 1 column 1
(char 0)` (`llm/structured.py:58-71`).

This is a **hypothesis with matching evidence, not a proven cause.**
`../../readiness.md:51-53` is explicit that the cause is not established and that no
429, auth or outage conclusion is supported.

## Root cause

An observability gap, not yet a behavioural bug. The information needed to
distinguish "model said nothing" from "model said the wrong shape" is discarded
at the only point where it exists.

## Fix

1. In `openrouter.py`, alongside the existing `LLMResponse`, capture and log
   **metadata only**:
   - `finish_reason`
   - whether `content` was empty
   - `completion_tokens` from `usage`
   - whether a `reasoning`-shaped field was present and non-empty, and its
     length (never its content)
2. Thread enough of this onto `LLMResponse` that
   [07](07-empty-vs-malformed-reply.md) can use it to classify the failure.
3. **Never log**: the API key, prompt content, message content, model reply
   text, full provider bodies, or artifact pointers. Lengths and enums only.
   Sanitizing log aggregation is what `../../readiness.md:50-53` did by hand for
   the last run; make it structural instead.
4. Add offline tests using the existing `llm/fake.py` harness covering: normal
   reply, `finish_reason: "length"` with empty content, reasoning-only reply
   with empty content, and a truly empty choices array.

## Acceptance criteria

- Metadata distinguishing empty content from unusable content is captured and
  visible in worker logs.
- No secret, prompt, reply body, pointer or full provider body can reach the
  logs. Review the diff for this explicitly; it is the whole safety constraint
  of this ticket.
- Offline tests cover each response shape with no network access.
- Existing transport tests still pass.

## Verification

```bash
# services/ai pytest configuration
pytest services/ai/tests/
```

Then run a **sanitized log read** over a single bounded job and confirm the new
fields appear and nothing sensitive does.

## Limits

- **This ticket diagnoses. It does not fix anything.** If the evidence comes back
  showing token exhaustion or a reasoning-only reply, the remedy is
  [08](08-narration-empty-content-remedy.md).
- Does not make any network call. [09](09-bounded-rerun-readiness-reaudit.md)
  owns execution and needs separate approval — it will consume preserved queue
  jobs.
- Do not change retry counts, `MAX_RETRIES_FREE`, or the cost ceiling. Free
  routing retrying three times is deliberate (`llm/structured.py:36-38`).
- Do not change model routing. Free-only stays free-only.

## Comments

- 2026-10-16: Added allowlisted response metadata to `LLMResponse` and an
  INFO-level metadata-only log event. Provider HTTP bodies and transport error
  details are no longer included in exceptions; unknown finish reasons normalize
  to `unknown`; malformed usage metadata also fails without echoing its value.
  The AI unit suite passed (230 passed, 11 deselected). The bounded live-job log
  read is not performed here; no network/job execution was authorized, and
  ticket 09 owns that step.
