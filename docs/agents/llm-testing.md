# LLM Test Policy

Use this policy before a live OpenRouter test. Unit tests use `FakeLLMClient` and
need no approval or ledger entry.

## Paid Tests

An agent may make paid-model calls only after the user gives explicit approval
in the current conversation. The approval must name, or clearly bound:

- the purpose and model or model family;
- the maximum number of calls; and
- a hard dollar limit for the whole experiment.

Before making a call, state the approved envelope and keep the experiment within
it. The per-job runtime ceiling is a safety guard, not approval for an aggregate
experiment. If the test needs another call, a different model, or a larger
envelope, obtain fresh approval first.

Run probes outside production queues and artifact writes unless the approval
explicitly covers those side effects. Preserve the shipping model configuration;
use a process-level override for a diagnostic. Never print or record an API key,
raw prompt, raw model reply, or chain-of-thought.

After each approved experiment, append a sanitized entry to
`.scratch/llm-usage.md` with the approval envelope, actual calls, known token
usage, actual spend, and result. Record unavailable usage fields as `not
captured`; do not estimate them as measured values.

## Free Tests

Free-route probes need no paid approval, but still use the same bounded,
outside-queue discipline and append their known token usage to the ledger.
