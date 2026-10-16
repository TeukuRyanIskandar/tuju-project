# 17 — Verify the narration remedy on the free route

Type: task
Status: resolved
Blocked by: none
Severity: high
Component: `services/ai`

> Numbering note: this was requested as "ticket 15". Ticket 15 is already
> `15-doc-drift-and-dead-code.md` and is `resolved`, so this took the next free
> number rather than overwriting it.

## Problem

[08](08-narration-empty-content-remedy.md) is resolved: the narration failure was
diagnosed as **Outcome A (token exhaustion)** and the remedy was to raise
`NARRATE_MAX_TOKENS` from `300` to `1024` (`ta_fa_analysis.py:51-52`).

**That remedy has never been executed against a live provider.** The only live
narration evidence in the repo is the *failing* probe at 300 tokens. Everything
since has been offline tests, which prove the constant's value — not that the
free route now produces usable prose. [09](09-bounded-rerun-readiness-reaudit.md)
lists 08 as resolved, but its own acceptance criteria demand "genuine model prose,
not a facts-only placeholder". Nobody has shown a free-route run can do that at
1024.

So the effort currently rests on an unverified premise: that the free router can
narrate at all.

## Evidence

### What 08 established

One bounded probe: `openrouter/free`, live 1155 technical reference, production
`build_ta_messages`, `max_tokens=300`. Sanitized provider facts:

| Field | Value |
| --- | --- |
| requested model | `openrouter/free` |
| served model | `poolside/laguna-s-2.1:free` |
| `finish_reason` | `length` |
| `completion_tokens` | `300` |
| content | empty |
| reasoning | present, 893 chars |

That is exactly the [`audit.md`](../audit.md) §1a prediction: a reasoning-tier
model spending the whole budget before emitting visible `content`, which
`extract_json("")` then reports as a shape error.

### Measured cost of one narration (this ticket's basis)

Prompt sizes measured against the live reference, priced with the repo's own
`llm/cost.py` table:

| Job | Prompt chars | Est. prompt tokens |
| --- | --- | --- |
| TA `1155` | 3,158 | 1,053 |
| FA `1155` | 3,266 | 1,089 |

| Model | First pass (~150 out) | Worst call (1,024 out) | Worst narration (2 calls) |
| --- | --- | --- | --- |
| `gemini-2.5-flash` | $0.0007 | $0.0029 | $0.0058 |
| `gemini-2.5-pro` | $0.0028 | $0.0116 | $0.0231 |
| `claude-sonnet-4.5` | $0.0054 | $0.0185 | $0.0370 |

47 remaining TA/FA jobs is **~$0.03** on the cheapest model.

### The budget is already structurally safe

The cost guard bounds exposure regardless of credit on hand: `$0.10` per TA/FA
narration (`config.py:46`), `$2.00` per prospectus (`config.py:43`). Ten narrations
plus both prospectus documents caps at **$5.00 exactly**, and in the pathological
case where a job hits its ceiling the job also *fails*, so that figure is
unreachable in practice. The operator has separately confirmed a zero-credit
account; only `openrouter/free` is available, and it is priced at $0.

### Four things spending money does not buy

Recorded so a later reader does not "solve" this by switching routing:

1. **It would have hidden the bug.** A paid non-reasoning model likely never
   exhausted the budget. This confirms the code was sound and the *router* was the
   variable — it validates nothing about the route that ships.
2. **It does not verify the fix.** The acceptance test for 08's remedy is the
   free route, which costs $0.
3. **Routing silently halves retries.** `structured.py:104` picks
   `MAX_RETRIES_FREE = 3` (4 attempts) only when `tracker.free`, else
   `MAX_RETRIES = 1` (2 attempts). Pinning `LLM_MODEL` changes failure semantics
   with no code edit.
4. **The other failure mode is untouched.** The 4 `facts_only` landings came from
   **grounding rejection**, not token exhaustion (`readiness.md:41-56`). A larger
   budget does nothing for them.

## Root cause

Not a defect. The remedy is implemented and offline-tested; this is the missing
verification step between "the constant changed" and "the free route narrates".

## Fix

Two bounded probes. Both run **outside BullMQ** — no enqueue, no artifact write,
no retry of the 9 preserved failed jobs, and a throwaway container that never
joins the queue consumer set. No code changes: `LLM_MODEL` is env-only
(`docker-compose.yml:168`) and the budget is imported from `NARRATE_MAX_TOKENS`
so a probe cannot drift from the shipped constant.

Each probe drives the **real** `narrate()` step through a genuine `LLMSession`
from `LLMRuntime.from_settings`, wrapped in a pass-through that records only
ticket-06-allowlisted metadata. One sequence then yields both the per-attempt
provider facts and the end-to-end verdict. The session carries the real `$0.10`
narration ceiling, so a misbehaving probe trips the guard rather than any credit.

**Probe A — isolate budget from model.** `LLM_MODEL=google/gemini-2.5-flash`,
same 1155 reference, 1024 budget. Confirms request builder, JSON mode and
validators are sound, isolating the failure to routing/budget interaction.
Cost: under $0.01. *Probe A is a diagnostic with an operator-approved one-off
deviation from the free-only rule below, and nothing more.*

**Probe B — verify the actual fix.** Identical input on `openrouter/free`. This is
the acceptance test for 08. Cost: $0.

Shape, run from a throwaway worker container:

```bash
docker compose run --rm --no-deps \
  -e LLM_MODEL=<openrouter/free|google/gemini-2.5-flash> ai-worker python -c "
import json, httpx
from tuju_ai.config import Settings
from tuju_ai.llm import LLMRuntime
from tuju_ai.llm.base import LLMResponse
from tuju_ai.ta_fa_analysis import NARRATE_MAX_TOKENS, build_ta_messages, narrate

settings = Settings.from_env()
ref = httpx.get(settings.backend_api_url + '/stocks/1155/analysis/reference', timeout=30).json()
t = ref['technical']
facts = {'sma': t.get('sma'),
         'rsi': {'period': 14, 'value': (t.get('rsi') or {}).get('value')},
         'macd': t.get('macd'), 'week52': t.get('week52')}
events = ref.get('technicalEvents', [])

runtime = LLMRuntime.from_settings(settings)
real, session = runtime.client, runtime.session('analyze-technical')

class Recording:
    model = real.model
    def __init__(self): self.attempts = []
    def complete(self, messages, **kw):
        resp = real.complete(messages, **kw)
        m = resp.response_metadata
        self.attempts.append({'finishReason': m.finish_reason,
                              'completionTokens': m.completion_tokens,
                              'contentEmpty': m.content_empty,
                              'reasoningPresent': m.reasoning_present,
                              'reasoningLength': m.reasoning_length})
        return resp

recording = Recording()
session = LLMRuntime(client=recording,
                     ceilings_usd=runtime.ceilings_usd).session('analyze-technical')
try:
    narrative, facts_only = narrate(session, build_ta_messages('1155', '1D', facts, events), facts, events)
    verdict = 'facts-only' if facts_only else ('narrative' if narrative.strip() else 'empty')
    print(json.dumps({'probe': 'ta-1155', 'requestedModel': real.model,
                      'budget': NARRATE_MAX_TOKENS, 'attempts': recording.attempts,
                      'verdict': verdict, 'words': len(narrative.split()),
                      'spendUsd': session.tracker.report()['estimatedCostUsd']}, indent=2))
except Exception as exc:
    print(json.dumps({'probe': 'ta-1155', 'requestedModel': real.model,
                      'budget': NARRATE_MAX_TOKENS, 'attempts': recording.attempts,
                      'verdict': 'terminal', 'error': type(exc).__name__,
                      'reason': str(exc)}, indent=2))
"
```

Record, per attempt: `finishReason`, `completionTokens`, `contentEmpty`,
`reasoningPresent`, `reasoningLength`. Then the verdict — `narrative`,
`facts-only`, `empty`, or `terminal` with its classified reason.

### Decision table for Probe B

| Result | Meaning | Next step |
| --- | --- | --- |
| grounded `narrative` | 08's remedy confirmed on the shipping route | Record the sample; ticket 09 gains its missing evidence |
| empty at 1024, `length` | Free reasoning models need a larger budget | Re-probe free at **one** higher bound, then stop and report |
| parses, grounding rejects | The separate `facts_only` failure mode | New finding; **do not** loosen grounding |
| terminal, request rejected | Provider/account constraint | Record it; free routing may need an account condition |

## Recording the sample narrative

The operator asked that a successful narrative be recorded as future reference.
Precedent: `readiness.md:81-82` already records real ingested indicator values in
the tracker. These are public market figures in a private repo, not credentials
or prompt content.

**It must be recorded as a labelled point-in-time sample, never a golden
fixture.** `openrouter/free` chooses a different model per request —
`poolside/laguna-s-2.1:free` served the probe above — so this prose cannot
reproduce. Recording it with its provenance (stock, requested router, served
model, budget, capture date, word count, grounding verdict) is honest; wiring it
into a test as expected output is a defect waiting to happen, because exact-output
expectations are wrong by construction under free routing.

Append findings under this ticket's `## Comments`; also append Probe B's evidence
to [08](08-narration-empty-content-remedy.md) so 08's own record carries proof its
remedy worked. Update `map.md`: 08 is no longer `needs-triage`, and add 17 to the
ticket count and dependency graph.

## Acceptance criteria

- Two probes executed outside the queue; no artifact written and no preserved job
  consumed.
- Probe A establishes whether the request/validator path is sound independent of
  routing.
- Probe B either confirms a grounded free-route narrative at 1024, or records
  which of the four decision-table states holds.
- A successful sample is recorded with full provenance and an explicit
  not-a-fixture warning.
- Free-only routing unchanged for anything that ships. `NARRATE_MAX_TOKENS`,
  `MAX_RETRIES*`, the cost ceilings, the facts-only placeholders and terminal
  semantics are all untouched by this ticket.

## Verification

```bash
uv run --project services/ai pytest    # must stay green; this ticket changes no code
```

Both probes are the real verification. If Probe B changes no code, the suite
result stands as-is from 08 (247 passed).

## Limits

- **This ticket changes no application code.** It runs two probes and records
  what they measured. If a probe suggests a code change, that is a new ticket.
- **Probe A is a diagnostic exception, not a routing change.** Do not carry
  `gemini-2.5-flash` into any run that produces shipped artifacts;
  `provenance.model` would record a paid model.
- Do not loosen `llm/grounding.py` to make prose pass. Manufacturing presentable
  narrative is forbidden by `spec.md`.
- Do not enqueue, dequeue, retry or purge anything. Ticket
  [09](09-bounded-rerun-readiness-reaudit.md) owns execution and still needs
  explicit operator approval.
- Do not touch the prospectus path. Its prompt size is unmeasured here — only its
  `$2.00` ceiling is enforced — and it is a separate approval question.
- Do not record probe prose in worker logs. It belongs in this ticket's record
  only, per ticket 06's sanitization discipline.

## Answer

Both probes ran 2026-10-16 outside the queue. No artifact written, no job
enqueued or retried. Total spend **$0.0019**.

**The headline finding is not the one this ticket predicted.** Probe A proved
08's remedy is necessary but **not sufficient**, and Probe B found a *second*
defect that independently makes narration unreachable. Both are filed as
[18](18-grounding-rejects-grounded-narrative.md).

### Probe A — `google/gemini-2.5-flash`, budget 1024

Content was never empty. Two attempts, `finishReason=stop`, 230 and 199
completion tokens, no reasoning field. The narrative was still degraded to
**facts-only**, rejected by grounding:

```
step 'narrate': the model's reply was still unusable after 1 retry
(number '20' is not in the facts; use ONLY numbers from the data)
```

So on a well-behaved non-reasoning model, 08's remedy removes the empty-content
failure and exposes the next one. Fixing the budget alone does **not** produce
narration.

### Probe B — `openrouter/free`, budget 1024

Four attempts; two distinct failure modes, both captured:

| Attempt | finishReason | completionTokens | content empty | reasoning chars |
| --- | --- | --- | --- | --- |
| 1 | `length` | 1024 | yes | 3468 |
| 2 | `stop` | **2074** | no | 4567 |
| 3 | `length` | 1024 | yes | 2694 |
| 4 | `length` | 1024 | no | 1984 |

Terminal: `MalformedModelOutput` after 3 retries.

Two things follow, and both matter.

**1. 1024 is still not enough for the free route.** Three of four attempts
exhausted the budget in reasoning (1,984–4,567 chars). Attempt 2 succeeded and
reported **2,074 completion tokens against `max_tokens=1024`** — so on this route
the provider's reported `completion_tokens` appears to include reasoning beyond
the requested cap, and visible content is not what the budget measures. Any
future budget chosen from the visible-content assumption will be wrong. Free
reasoning length also varies per request because the router picks the model each
time.

**2. Attempt 2 produced a well-formed, largely accurate narrative that the
validator rejected.** Verbatim, for reference:

> On 1D, the stock closed at 10.04, just above the prior swing high of 9.98,
> indicating a breakout of that level. The MACD line of -0.134 crossed above its
> signal of -0.155, producing a bullish histogram of 0.0208. RSI‑14 sits at 43.93,
> within the mid band, showing neutral momentum. Price remains below the 20‑day
> SMA of 10.0555 and the 50‑day SMA of 10.3754, while the 200‑day SMA is higher at
> 10.98235. The 52‑week range spans 9.80 to 12.38, with the close 18.9% below the
> high.

**This is recorded as a rejected sample, not a passing one.** It is the evidence,
not a success. Its numbers are not all grounded, and the distinction is the whole
finding — see ticket 18, which separates the three numbers the validator got
wrong from the one it got right.

### What an agent should do next

1. Work [18](18-grounding-rejects-grounded-narrative.md) first. It is the actual
   blocker to genuine narration and it is offline — no provider needed.
2. Re-run these probes after 18, on the free route, before requesting execution.
3. Only then ask the operator about [09](09-bounded-rerun-readiness-reaudit.md).
   **09 is still not ready:** 08 is satisfied, but nothing has yet produced a
   grounded narrative through the free route.

## Comments

- 2026-10-16 post-fix Probe B: ticket 18's grounding correction and ticket 19's
  4096-token budget were applied before a fresh real `narrate()` run against the
  live 1155 technical reference and `openrouter/free`. It used a rebuilt,
  throwaway `ai-worker` container outside BullMQ; no queue job or artifact was
  created. The active zero-credit account authenticated and spent `$0`.
- The router served four different free models. Two returned nonempty replies,
  one exhausted all 4096 tokens with empty content, and one returned empty
  content at `stop`. The terminal state was `facts_only` after validator
  exhaustion, not a grounded narrative. This is a free-route reliability result,
  not an authentication or paid-credit problem. Per-attempt provenance and token
  data are recorded in ticket 19. No sample prose is recorded because none
  passed grounding, and such prose must never be made a fixture.
- 2026-10-16 paid diagnostic: three bounded production-path probes used
  `google/gemini-2.5-flash` with `LLM_MODEL` overridden only in throwaway
  `ai-worker` containers. The two TA probes each returned a grounded narrative
  after one corrective retry: the first reply used an unsupported six-decimal
  number and the retry passed validation. Their measured cost was `$0.001897`
  each. The current-contract FA probe passed on its first reply (53 words,
  `$0.000734`). All successful replies had `finish_reason=stop`, nonempty
  content, no reasoning field, and retained the shipped 4096-token cap.
- An initial FA probe did not pass because the running backend predated the
  scale-contract work and omitted `scale: "fraction"` for ROE. It cost
  `$0.001432` across two correctly rejected attempts. Rebuilding only the local
  backend corrected the reference shape; no worker code or validation rule was
  loosened. Total paid diagnostic spend was approximately `$0.00596`. This is
  evidence for a paid-routing product decision, not a shipping routing change;
  `openrouter/free` remains the configured default.
