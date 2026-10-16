# 18 — Grounding rejects genuinely grounded narratives

Type: bug
Status: done
Blocked by: none
Severity: high
Component: `services/ai`

> Found by executing [17](17-free-route-narration-verification.md). Filed
> separately because 17 explicitly forbade code changes.

## Problem

The TA/FA grounding check rejects **true** statements, so a correct, honest
narrative is discarded and the job degrades to `facts_only`. This is the mirror
image of the fraction bug fixed in tickets 03/04 — there, a correct rendering was
rejected and the model was pushed toward a *false* statement; here, a correct
statement is rejected and the run is downgraded. It is the reason the showcase
cannot obtain genuine prose, and it is entirely **offline-fixable**: no provider
call is needed to reproduce it.

## Evidence

Both probes in [17](17-free-route-narration-verification.md) reproduce it,
against two different models.

**Probe A** (`google/gemini-2.5-flash`) — content was never empty. Two attempts
at `finishReason=stop`, 230 and 199 completion tokens, no reasoning field. Still
degraded:

```
step 'narrate': the model's reply was still unusable after 1 retry
(number '20' is not in the facts; use ONLY numbers from the data)
```

**Probe B** (`openrouter/free`) — attempt 2 returned a well-formed narrative,
`finishReason=stop`, and was rejected for the same class of number. Every numeral
it used is substantively present in the payload:

| Narrative says | Ground truth in the reference | Validator |
| --- | --- | --- |
| "the 20‑day SMA of 10.0555" | `technical.sma.p20 = 10.0555` | rejected `20` |
| "the 50‑day SMA of 10.3754" | `technical.sma.p50 = 10.3754` | rejected `50` |
| "the 200‑day SMA … at 10.98235" | `technical.sma.p200 = 10.98235` | rejected `200` |
| "RSI‑14 sits at 43.93" | `rsi.period = 14`, `rsi.value = 43.925724` | accepted |
| "The 52‑week range spans 9.80 to 12.38" | `technical.week52`, event id `week52_proximity` | rejected `52` |
| "the close 18.9% below the high" | event `week52_proximity.values.pctFromHigh = -18.90145395799678` | rejected `18.9` |

`10.04`, `9.98`, `-0.134`, `-0.155`, `0.0208`, `9.8`, `12.38` were all accepted.
The rejected set is exactly the numerals that live in **dict keys**, in **string
values (labels and ids)**, or as a **rounded rendering** of a stored float.

This also explains the 4 `facts_only` landings recorded in `readiness.md:41-56`.
They were not token exhaustion.

## Root cause

Two independent gaps in `llm/grounding.py`.

**1. `_source_numbers` (:54-85) harvests numeric values only.** `visit()`
recurses `obj.values()` for dicts and adds numeric leaves; it never reads
**dict keys** and never extracts numerals from **string values**. So `p20`, `p50`,
`p200`, `week52`, `"SMA-20 crossed above SMA-50"` and `"RSI-14 in mid band"`
contribute nothing, even though their periods are genuine facts the prompt shows
the model. The validator's notion of "in the facts" is narrower than the facts.

**2. `ungrounded_number` (:88-96) has no tolerance for rounding.** It matches
exact strings plus the integer part (`_source_numbers` :60-61). `18.9` matches
neither `18` nor `18.90145395799678`, so a *faithful* rendering of a stored
float is refused. Ticket 03 added ×100 rounding for `fraction` metrics only; it
did not add rounding tolerance for ordinary values.

Together these make the check reject the narratives it exists to admit. The
corrective retry is then fed a rejection the model cannot fix without dropping
true content — and on the free route it never gets that far, because the next
attempt exhausts its budget instead (see
[19](19-free-route-reasoning-token-budget.md)).

## Fix

Both in `llm/grounding.py`, with offline regressions for each.

1. **Harvest numerals from keys and string values.** Extend `_source_numbers` so
   a dict's keys and any string leaf contribute their numerals through the
   existing `_text_numbers`. This admits `20`/`50`/`200`/`52`/`14` from
   `p20`, `p50`, `p200`, `week52` and the event labels.
2. **Accept a rounded rendering of a known number.** Match a narrative numeral
   when it equals a known number *or* that number rounded to the same number of
   decimal places, within a small epsilon. Keep the existing integer-part rule.

Decide and record one precision rule and use it everywhere rather than inventing
a second: `ta_fa_analysis.HEADLINE_PRECISION = 4` already exists for the same
purpose, and both sides must round identically so the headline and the narrative
cannot disagree about a value.

### The constraint that matters most

**This must not weaken the check.** Its whole purpose is preventing a model from
asserting numbers the data does not support. Every current rejection reason in
`llm/grounding.py` and its tests must still be rejected:

- `number '42' is not in the facts` — 42 appears nowhere; still rejected.
- `28.999999999999996%` for a `0.29` fraction — float noise in place of the real
  number; still rejected. Do **not** let general rounding admit it; this is the
  case ticket 03 wrote `test_fa_narration_does_not_accept_float_noise_in_place_of_the_number` for.
- `47%` for a `0.045` dividend yield — wrong magnitude; still rejected.
- Banned advice terms; unchanged.

A fix that only relaxes checks is a regression, not a fix. Write the "must still
reject" cases first, watch them pass, then add the new admissions.

## Acceptance criteria

- A narrative naming `SMA-20`/`SMA-50`/`SMA-200`/`52-week`/`RSI-14` is **not**
  rejected for those period numbers.
- A narrative rendering `-18.90145395799678` as `18.9%` is **not** rejected.
- Every existing "must still reject" case above still rejects, including the
  float-noise case.
- `test_grounding_accepts_a_fraction_rendered_in_whole_units` and
  `test_grounding_leaves_a_non_fraction_scale_alone` still pass.
- The TA/FA facts-only placeholders at `ta_fa_analysis.py:42-49` are **not**
  touched. The frontend matches those strings byte for byte
  (`apps/frontend/src/components/stocks/analysis-presentation.ts:29-33`).
- Terminal semantics unchanged: an empty reply must stay terminal, never routed
  into the facts-only degrade.

## Verification

```bash
uv run --project services/ai pytest
```

All offline. No provider call, no queue, no artifacts.

Then re-run Probe B from [17](17-free-route-narration-verification.md) — it is
the only live check that matters, and it is free.

## Limits

- **Grounding only.** Do not touch the narration token budget, the retry bound,
  the cost ceilings, or model routing. The free-route budget is
  [19](19-free-route-reasoning-token-budget.md); mixing them makes neither
  verifiable.
- Do not add a tolerance wide enough to accept "20-day SMA at 10.06" for a stored
  `10.0555`… unless you intend that as a deliberate precision decision and record
  it. Pick the rule, state it, and test both sides of it.
- Do not modify the prompts to avoid the problem. Asking the model to stop naming
  SMA periods would hide a validator defect behind a prompt tweak.
- This ticket does not make the showcase demonstrable. Ticket
  [11](11-analysis-panel-duplicate-alert.md) and
  [13](13-chart-design-conformance.md) still await human review, and
  [09](09-bounded-rerun-readiness-reaudit.md) still needs operator approval.

## Results

2026-10-16: Implemented and verified offline. `_source_numbers` now harvests
numerals from dictionary keys and string leaves. Numeric values contribute their
absolute renderings rounded to one through four decimal places, matching
`HEADLINE_PRECISION = 4`; higher-precision renderings still require an exact
match. This admits the recorded period and `18.9%` cases without admitting
float noise or incorrect scales. The regression retains the invented-number,
fraction-scale, float-noise, and advice-term rejections. No provider call,
queue operation, or artifact write was made. `uv run --project services/ai
pytest` passed: 248 tests, with 25 pre-existing pytest and third-party warnings.
