# Task: worker handoff spec

Type: task
Status: open
Blocked by: 01, 02, 03, 04, 05, 06

## Question

Write `.scratch/poc-phase-a-worker/spec.md` (status `ready-for-agent`) from
tickets 01–06: problem statement, solution, implementation decisions (fact
assembly + reference read, handler shape + failure classes + progress,
prompt, grounding post-check, `facts_only` wire signal + headline policy,
cost ceiling), a **consumers** section naming the BE follow-ons (worker-facing
reference read, TS event detection, OCF ingest if chosen, hook `facts_only`
mapping), out of scope, acceptance. Then mark the map's destination reached.

Mirror the [backend handoff spec](../poc-phase-a-backend/spec.md) structure.
