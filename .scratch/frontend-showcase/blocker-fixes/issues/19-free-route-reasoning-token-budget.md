# 19 — The free route's reasoning budget is still not sufficient

Type: bug
Status: resolved
Blocked by: none
Severity: high
Component: `services/ai`

> Found by executing [17](17-free-route-narration-verification.md). The live
> evidence it gathered is already in hand; this ticket turns it into a decision.

## Problem

[08](08-narration-empty-content-remedy.md) raised `NARRATE_MAX_TOKENS` from 300
to 1024 and that was necessary but **not sufficient**. Probe B on
`openrouter/free` at 1024 exhausted the budget on three of four attempts, and one
attempt reported **more completion tokens than the cap it was given**.

Until this is resolved, no amount of retry or routing discipline produces a
free-route narrative — which means the showcase's free-only commitment cannot be
demonstrated.

## Evidence

Probe B, `openrouter/free`, `max_tokens=1024`, live 1155 reference:

| Attempt | finishReason | completionTokens | content empty | reasoning chars |
| --- | --- | --- | --- | --- |
| 1 | `length` | 1024 | yes | 3468 |
| 2 | `stop` | **2074** | no | 4567 |
| 3 | `length` | 1024 | yes | 2694 |
| 4 | `length` | 1024 | no | 1984 |

Terminal: `MalformedModelOutput` after 3 retries.

### Two distinct problems

**1. 1024 is too small for this route.** Reasoning ran 1,984–4,567 characters.
Attempt 1 and 3 produced nothing at all in `content`. This is the same
failure [08](08-narration-empty-content-remedy.md) diagnosed at 300, one budget
step up.

**2. The reported token accounting does not match the requested cap.** Attempt 2
reports `completion_tokens = 2074` while `max_tokens` was `1024`, and it is the
only attempt that finished (`finishReason=stop`). The most likely reading is that
on this route `completion_tokens` includes reasoning tokens that the `max_tokens`
cap does not bound, so **visible content is not what the budget measures**.

This is the reason a naive "raise it again" is not a safe answer: the unit the
provider reports is not the unit the cap controls.

### The variation problem

The free router selects a model per request — `poolside/laguna-s-2.1:free` served
ticket 08's probe. Reasoning length therefore varies per request by model, and a
single budget is a bet against an unknown distribution. `readiness.md` records
announcement jobs succeeding at a different budget, which is consistent with
per-model behaviour rather than a uniform provider fault.

## Root cause

A reasoning-tier free model spends budget on reasoning that the requested
`max_tokens` does not bound, while `structured.py` treats an empty reply as a
malformed one and burns a bounded retry doing it.

## Fix

1. **Establish what `max_tokens` actually bounds on this route** before choosing
   any new value. Probe a single free request at two different caps and compare
   reported `completion_tokens`, `finishReason`, `reasoning_length` and whether
   `content` is emitted. Do not pick a budget from an assumption about this axis.
2. **Decide the budget from that measurement**, at the level that makes the
   narrated step reliable rather than marginally reliable. Note the cost
   consequence in Fix 3 before committing.
3. **Cost check before shipping the number.** The narration ceiling is `$0.10`
   per document (`config.py:46`) and the free router is priced at `$0`
   (`llm/cost.py:49`), so a bigger cap costs nothing *on this route* — but the
   same constant applies to a paid model if anyone ever routes one, where
   `worst_case_call_usd` scales with `max_tokens`. At
   `google/gemini-2.5-flash` a 1,053-token prompt costs ~$0.0007 at 150 output
   tokens and ~$0.0029 at 1024; a 4,096-token cap would be ~$0.011 per call and
   ~$0.023 across a 2-attempt paid narration, still inside `$0.10` — but say so
   explicitly rather than leaving it unexamined.
4. **Re-run Probe B** from [17](17-free-route-narration-verification.md) at the
   new budget. Success means a `content`-bearing, parseable reply — note that
   [18](18-grounding-rejects-grounded-narrative.md) is what decides whether that
   reply then becomes a narrative, so a grounding rejection here is the expected
   remaining outcome, not a failure of this ticket.

## Acceptance criteria

- A recorded measurement showing what `max_tokens` bounds on the free route,
  with at least two cap values compared.
- `NARRATE_MAX_TOKENS` set from that measurement, with the reasoning recorded.
- `test_narration_uses_expanded_token_budget` updated to the new value, still
  asserting the real `narrate()` call receives it.
- Free-only routing unchanged; no paid model introduced.
- Retry bound, cost ceilings and facts-only placeholders unchanged.
- Full AI suite green.

## Verification

```bash
uv run --project services/ai pytest
```

Plus the live free-route probe, which is the only thing that proves this.

## Limits

- **Fix 4's success criterion is a non-empty parseable reply, not a narrative.**
  Grounding is [18](18-grounding-rejects-grounded-narrative.md). Do not claim a
  working narrative from a reply that grounding then rejected, and do not touch
  grounding here to force one.
- Do not change `MAX_RETRIES_FREE`. Free routing retrying three times is
  deliberate (`llm/structured.py:36-38`, ticket 06).
- Do not pin a specific free model as a workaround. Routing stays
  `openrouter/free`; a pinned model is a product decision with a cost
  consequence, not a bug fix.
- Single requests, low volume. Do not run the queue.
- If no budget makes the free route reliable, that is **Outcome C** territory
  from ticket 08's decision tree and belongs in this ticket's record as a
  documented `wontfix` for free-only narration — not a silent switch to a paid
  model, and not an invented narrative.

## Results

2026-10-16: Two direct, single-attempt OpenRouter calls ran outside BullMQ using
the production TA narration prompt and the live `1155` technical reference. No
queue was used and no artifact was written. The configured `OPENROUTER_API_KEY`
was present, the configured route was `openrouter/free`, and the live reference
endpoint returned HTTP 200. No credential, prompt output, or raw reasoning was
recorded.

| Requested model | Served model | Cap | Finish reason | Usage (prompt / completion / reasoning) | Content | Parse / schema |
| --- | --- | ---: | --- | --- | --- | --- |
| `openrouter/free` | `nvidia/nemotron-3-super-120b-a12b:free` | 1024 | `stop` | 1177 / 709 / 477 | nonempty | parsed / valid |
| `openrouter/free` | `cohere/north-mini-code:free` | 4096 | `stop` | 976 / 1188 / 849 | nonempty | parsed / valid |

Both responses exposed reasoning (`1305` and `3315` characters respectively);
cached prompt tokens were `0`. The response metadata showed that completion
usage includes a separately reported reasoning component, so it is not a
visible-content-only budget. This confirms the route can serve different models
and that a successful 1024 response is not evidence that 1024 is sufficient:
the prior four-attempt 1024 measurement exhausted three attempts in reasoning.

`NARRATE_MAX_TOKENS` is therefore raised to `4096`, the one higher bound measured
here. It is the minimum change supported by this two-cap comparison that avoids
retaining the repeatedly exhausted 1024 cap; no unmeasured intermediate cap is
claimed reliable. Free-only routing, retries, grounding, facts-only behavior,
and cost ceilings are unchanged. `openrouter/free` remains priced at $0. If a
paid route is explicitly selected later, a 4096-token worst-case narration call
is about $0.011 on `google/gemini-2.5-flash`, or about $0.023 across its two
attempts, below the existing $0.10 ceiling.

### Shipping-path follow-up

2026-10-16: After rebuilding `ai-worker` from the updated source, the real
`narrate()` path ran once outside BullMQ against the same live reference at the
shipped 4096 cap. No queue job or artifact was created. The active zero-credit
account authenticated to `openrouter/free`, and cost was `$0`.

| Attempt | Served model | Finish reason | Completion tokens | Content empty | Reasoning chars |
| ---: | --- | --- | ---: | --- | ---: |
| 1 | `nvidia/nemotron-3-super-120b-a12b:free` | `stop` | 743 | no | 1357 |
| 2 | `dots-studio/dots-3-note-preview:free` | `length` | 4096 | yes | 11192 |
| 3 | `poolside/laguna-xs-2.1:free` | `stop` | 168 | yes | 443 |
| 4 | `nvidia/nemotron-3.5-super-vl:free` | `stop` | 1143 | no | 2085 |

The terminal result was `facts_only` after validator exhaustion, not a grounded
narrative. This validates the implementation and proves that credits are not the
blocker, but does not establish reliable free-only narration: the router still
changes models and can exhaust a full 4096-token budget. Do not silently switch
routing or claim ticket 09's live-artifact prerequisite is met.
