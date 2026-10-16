# Local LLM Usage Ledger

Sanitized record of live OpenRouter experiments. It is not provider billing:
fields not returned by the client are recorded as `not captured`, never guessed.
No API keys, raw prompts, raw replies, or reasoning content belong here.

## Rules

- Add one entry for every live experiment after it completes.
- Paid entries must cite the explicit approval envelope from the current
  conversation and remain within it.
- Record the provider-reported model, calls, known tokens, spend, and outcome.
- Free experiments still record usage because quota and routing are finite.

## 2026-10-16 — Frontend showcase narration probes

| Route / model | Purpose | Calls | Prompt tokens | Completion tokens | Reasoning tokens | Spend (USD) | Outcome |
| --- | --- | ---: | --- | ---: | --- | ---: | --- |
| `openrouter/free` | Ticket 08 initial TA exhaustion diagnosis | 1 | not captured | 300 | not captured | 0 | Empty response at the 300-token cap. |
| `openrouter/free` | Ticket 17 initial TA free-route verification | 4 | not captured | 5,146 | not captured | 0 | One parseable reply was rejected by the then-defective grounding check; three attempts exhausted or malformed. |
| `openrouter/free` | Ticket 19 two-cap direct TA measurement | 2 | 2,153 | 1,897 | 1,326 | 0 | Both replies parsed and validated; measurements selected the 4,096-token cap. |
| `openrouter/free` | Ticket 17 post-fix production TA narration | 4 | not captured | 6,150 | not captured | 0 | `facts_only`; free router served four models and remained unreliable. |
| `google/gemini-2.5-flash` | Ticket 17 original paid TA diagnostic | 2 | not captured | 429 | 0 | 0.001900 | Nonempty replies exposed the grounding defect later fixed in ticket 18. |
| `google/gemini-2.5-flash` | Approved paid TA repeatability test | 4 | not captured | 858 | 0 | 0.003794 | Two grounded narratives, each after one corrective retry. |
| `google/gemini-2.5-flash` | Approved paid FA test against stale backend | 2 | not captured | 288 | 0 | 0.001432 | Correctly rejected: stale backend omitted `scale: "fraction"` for ROE. |
| `google/gemini-2.5-flash` | Approved paid FA test against rebuilt backend | 1 | not captured | 152 | 0 | 0.000734 | Grounded narrative on the first attempt. |

### Paid Approval And Totals

- Approval: `google/gemini-2.5-flash`, three narration probes, six calls maximum,
  `$0.30` maximum. The stale-backend diagnosis required one additional FA probe,
  so the experiment exceeded its six-call cap even though actual spend remained
  well below the dollar cap. Record this as a process exception, not expanded
  approval; future tests require fresh approval before exceeding either limit.
- Approved-experiment actuals: 7 calls, 1,298 known completion tokens, `$0.005960`.
- Known paid total including the earlier ticket-17 diagnostic: 9 calls, 1,727
  known completion tokens, `$0.007860`.
- Known free total: 11 calls, 13,493 completion tokens. The direct measurements
  report 1,326 reasoning tokens; the other probes only reported reasoning
  character counts, so their reasoning-token counts are not captured.

## 2026-10-16 — Ticket 09 fresh three-job canary

| Route / model | Purpose | Calls | Prompt tokens | Completion tokens | Reasoning tokens | Spend (USD) | Outcome |
| --- | --- | ---: | ---: | ---: | --- | ---: | --- |
| `google/gemini-2.5-flash` | Ticket 09 approved fresh TA/FA/prospectus queue run | 10 | 37,010 | 3,263 | not captured | 0.019260 | All three jobs completed; stock artifacts were grounded and contract-valid; prospectus artifact and summary were contract-valid. |

Approval in the current conversation: three fresh jobs in order (1155 TA, 1155
FA, Insights Analytics Berhad prospectus), `google/gemini-2.5-flash`, maximum 20
provider calls and `$1.00` aggregate spend. Each stage was verified before the
next was enqueued. Temporary worker ceilings were `$0.05` per TA/FA narration
and `$0.80` for the prospectus (combined configured ceilings `$0.90`). The
measured tracker cost was `$0.019260`; provider invoice/billing data was not
captured. No raw prompt, response, or reasoning was recorded.

Breakdown: TA 2 calls / 2,748 prompt / 429 completion / `$0.001897`; FA 1 call /
1,181 prompt / 124 completion / `$0.000664`; prospectus 7 calls / 33,081 prompt /
2,710 completion / `$0.016699`. Total actual was 10/20 calls and `$0.019260` /
`$1.00` approved spend. Reasoning tokens were not captured.

Routing was an invocation-only override; the shipping `openrouter/free` default
was not changed. The approved old queue was purged; Postgres and LocalStack
volumes were preserved. No ingestion job ran, and no unrelated or failed job was
retried.

Update known paid totals: 19 calls and 4,990 known completion tokens, with
`$0.027120` known local-estimate spend across the earlier paid probes and this
canary. Historical prompt-token totals remain not captured.
