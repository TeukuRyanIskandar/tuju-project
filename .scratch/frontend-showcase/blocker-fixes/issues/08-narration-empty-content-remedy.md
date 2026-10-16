# 08 — Resolve the narration empty-content cause

Type: bug
Status: resolved
Blocked by: 07
Severity: high
Component: `services/ai`

## Problem

Nine of thirteen TA/FA jobs failed terminally with no usable narration. The cause
is not established. Until it is, parent ticket 01 cannot select a single complete
stock, because `facts_only` output is explicitly not presentable as explanatory
prose (`../../readiness.md:79-81`).

## Evidence

`../../readiness.md:41-56`, ticket 14. Final queue state at `06:56:41Z`: 59
completed (55 announcements, 4 TA/FA facts_only), 9 failed, 49 waiting, 0 active.
Failed TA: 6888, 6947, 1023, 5398, 5819. Failed FA: 5326, 6888, 1023, 5819.

The hypothesis, per [`../audit.md`](../audit.md) §1a:

1. `llm/openrouter.py:121` reads `content` and discards `finish_reason` and any
   reasoning field.
2. `ta_fa_analysis.py:55` allows 300 completion tokens.
3. A reasoning-tier free model can exhaust that budget before emitting
   `content`.
4. `extract_json("")` raises exactly the observed
   `Expecting value: line 1 column 1 (char 0)`.

Supporting observations: all 55 announcement jobs succeeded; 52 HTTP 200
responses were logged, so the provider was responding.

**Not established.** `../../readiness.md:50-53` explicitly declines to conclude
empty content, truncation, 429, auth or outage. Root cause is unproven.

## Root cause

Unknown pending [06](06-openrouter-response-diagnostics.md) evidence and
[07](07-empty-vs-malformed-reply.md) classification. This ticket is the point
where the evidence decides the answer.

## Decision tree — set one outcome with evidence

**Outcome A — token exhaustion.** Evidence: `finish_reason: "length"`, empty or
absent content, completion tokens at the cap. Remedy is scoped: raise
`NARRATE_MAX_TOKENS` for the narrate step only, re-run one bounded job, confirm.
The 300-token budget is genuinely tight for a narrative.

**Outcome B — reasoning-only reply.** Evidence: non-empty reasoning field, empty
`content`. The provider is returning output in a field the client does not read.
Remedy is to read that field when `content` is empty — a real fix, and it does
not depend on the model changing.

**Outcome C — provider-side free-tier behaviour.** Evidence: empty `content` with
`finish_reason: "stop"` and a populated reasoning field, reproducible across
models and token budgets. **Then this ticket is `wontfix`**, the finding is
documented, and the parent effort records that free-only routing cannot produce
narrative. That is a legitimate, honest resolution — record it rather than
inventing a fallback narrative or silently switching to a paid model.

**Outcome D — request-side.** Evidence: malformed request, unsupported
structured-output mode. Remedy is in the request builder, not the response
reader.

## Fix

Decide A/B/C/D from real captured evidence. Implement only the matching remedy.

Hard constraints regardless of outcome:

- Free-only routing stays free-only. No paid model, no model substitution, no
  silent fallback.
- **No invented narrative.** The facts-only placeholders at
  `ta_fa_analysis.py:42-49` remain the only degrade path, and their strings must
  not change — the frontend matches them byte for byte
  (`apps/frontend/src/components/stocks/analysis-presentation.ts:29-33`).
- Preserve terminal and facts-only semantics and the cost ceiling.
- Record the outcome, the evidence and the reasoning under `## Comments`.

## Acceptance criteria

- The measured structured-output failure is explained with sanitized evidence
  from [06](06-openrouter-response-diagnostics.md), naming which outcome applies.
- The remedy, if any, is minimal and scoped to the diagnosed cause.
- Terminal, facts-only and cost-ceiling semantics are unchanged.
- `wontfix` is recorded with a clear rationale if Outcome C holds.

## Verification

```bash
# services/ai pytest configuration
pytest services/ai/tests/
```

For Outcomes A, B or D, a **separately approved** bounded single-job run. That
run is part of [09](09-bounded-rerun-readiness-reaudit.md), not this ticket.

## Limits

- This ticket cannot be actioned without a network run, and
  [09](09-bounded-rerun-readiness-reaudit.md) requires explicit approval because
  it consumes preserved queue jobs. Do not restart the worker here.
- Do not force-retry the 9 failed jobs. One BullMQ attempt each is preserved
  state (`../../readiness.md:44-46`).
- Resolving this does not complete parent ticket 01. Tickets 11, 13, the rights
  review and the Part-1-only prospectus inputs all remain.

## Comments

- 2026-10-16: Outcome A (token exhaustion) confirmed by one direct, bounded
  TA narration probe. The probe used `openrouter/free`, the live 1155 technical
  reference and the production request builder, with `max_tokens=300`; it did
  not start BullMQ, write an artifact, or consume any preserved job. Sanitized
  provider facts: served model `poolside/laguna-s-2.1:free`,
  `finish_reason=length`, `completion_tokens=300`, empty content and reasoning
  present (893 characters). This exactly supports token exhaustion before the
  model emitted its visible JSON response.
- The scoped remedy raises only `NARRATE_MAX_TOKENS` from 300 to 1024. It does
  not read reasoning as a narrative, change the free-only router, retries,
  validators, cost ceiling, terminal handling, or facts-only placeholders. An
  offline regression asserts the narration call receives the new budget. `uv
  run --project services/ai pytest` passed: 247 tests; 25 existing pytest and
  third-party warnings. A bounded BullMQ job to validate end-to-end output
  remains ticket 09's separate operator-approved operation.
- 2026-10-16 follow-up from [17](17-free-route-narration-verification.md): the
  remedy is **necessary but not sufficient**, and two further defects surfaced.
  On `google/gemini-2.5-flash` at 1024 tokens, content was never empty (230 and
  199 completion tokens, `finishReason=stop`) yet the run still degraded to
  facts-only. On `openrouter/free` at 1024, three of four attempts exhausted the
  budget in reasoning (1,984-4,567 chars) and the terminal reason was again
  `MalformedModelOutput`. Attempt 2 did emit parseable content, rejected by
  grounding. Filed as [18](18-grounding-rejects-grounded-narrative.md) (grounding
  rejects true statements) and
  [19](19-free-route-reasoning-token-budget.md) (free-route budget still short,
  and `completion_tokens` appears to exceed the requested cap). **08's own
   diagnosis stands** — token exhaustion was and is real — but its remedy alone
   does not yield a narrative, so this ticket is not by itself sufficient
   evidence for [09](09-bounded-rerun-readiness-reaudit.md).
- 2026-10-16 post-fix verification: ticket 19 raised the shipped cap to 4096
  after bounded free-route measurements. A rebuilt throwaway worker then ran
  the real narration path with the active zero-credit account. One routed model
  still exhausted all 4096 tokens before content, while the remaining attempts
  did not survive validation; the result was `facts_only`. This confirms the
  original token-exhaustion diagnosis and shows that a larger cap alone cannot
  make a randomly routed free model dependable. Details are in 17 and 19;
  ticket 09 remains blocked.
