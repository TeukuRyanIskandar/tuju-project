# Build ticket: enqueue-klci + nightly follow-on

Type: task
Status: resolved
Blocked by: 01, 04

> Execution of handoff § system enqueue TA/FA (planning ticket 05).
> Wave 3. Prefer ticket 03 landed so nightly follow-on can hook after ingest.

## Scope (this ticket only)

- Command: **`enqueue-klci`** [stockCode] [`--force`] in `worker-main.ts`.
- Fan-out over KLCI 30 × (`analyze-technical` + `analyze-fundamental`).
- Envelope: `trigger`/`requestedBy` = `system`; fresh `correlationId`;
  TA `timeframe: '1D'`; FA `period: 'quarterly'`; `asOf` = wall clock ISO;
  payload `symbol` = Bursa `stockCode`.
- **Skip (non-force):** row `status ∈ {ready, facts_only}` and
  `as_of`/`updated_at` same **UTC calendar day**.
- Still enqueue missing / pending / running / failed / stale.
- On enqueue: upsert analysis row → `pending`.
- Per-symbol failures: log + continue the batch.
- Cadence: CLI + **nightly follow-on after successful ingest** when
  `DATA_SOURCE=yfinance`. No browser `@RequiresJob` in PoC.

## Out of scope

- HTTP reads (ticket 06).
- Changing BullMQ `deriveJobId` hour-bucket behaviour.
- Writing `facts_only` from worker (not this ticket).

## Testing seam

- Unit: skip same-day ready; `--force` re-enqueues; pending upsert;
  optional single-code fan-out of 2 jobs.

## Acceptance

- `enqueue-klci` registered; skip/force behaviour tested; nightly follow-on
  wired when yfinance bound.

## Answer

- `KlciEnqueueService` + `enqueue-klci [--force] [stockCode]` in worker-main.
- Skip same-UTC-day ready/facts_only; `--force` bypasses; upsert → pending.
- Clears completed/failed BullMQ jobs (prospectus pattern); in-flight collapses.
- Nightly: `runNightly` post-commit calls enqueue when `provenanceClass=real`.
- Unit: [`klci-enqueue.spec.ts`](../../apps/backend/src/ingestion/klci-enqueue.spec.ts).
