# Decide: system enqueue for TA/FA (KLCI 30)

Type: grilling
Status: resolved
Blocked by: 01, 04

## Question

Parent: reuse `analyze-technical` + `analyze-fundamental` with
`trigger: 'system'`; nightly post-ingest + ops/CLI; fan-out 30×2; per-symbol
failure isolation; BullMQ dedup by symbol + job + day. No browser
`@RequiresJob` path in PoC.

Pin the **enqueue seam** (mirror `enqueue-prospectus` where it fits):

1. Ops command name + args (all 30 vs one code; `--force`)?
2. Envelope defaults (`timeframe: 1D`, `period: quarterly`, correlationId)?
3. Dedup key shape and what “already enqueued today” means vs “already has
   latest analysis row”?
4. Does enqueue create/update a `pending`/`running` persistence row before the
   worker finishes (ticket 04)?
5. Cron after ingest vs CLI-only for the PoC checkpoint?

Fixed inputs: parent ticket 02; ADR-0005 / ADR-0013; existing JobBus producer
in `apps/backend/src/jobbus`.

## Notes

- Worker fact assembly is out of scope (worker map) — this ticket only covers
  Nest producing envelopes and tracking eligibility.

## Answer

**Single `enqueue-klci` command; skip ready/facts_only same calendar day;
CLI + nightly follow-on when yfinance DI bound; upsert pending rows on
enqueue (ticket 04).**

### 1. Command

| Command | Role |
| --- | --- |
| `enqueue-klci` | Fan-out `analyze-technical` + `analyze-fundamental` for the KLCI 30 seed |
| `enqueue-klci <stockCode>` | Same pair for one code only |
| `enqueue-klci --force [stockCode]` | Ignore skip rule; re-enqueue even if ready/facts_only today |

Mirror prospectus ops style (`enqueue-prospectus` / optional id / force).
Universe = `klci30-universe.ts` only (ticket 01). Per-symbol failures do not
abort the batch (log + continue), same spirit as ingest skip+continue.

### 2. Envelope defaults

- `trigger: 'system'`, `requestedBy: 'system'` (ADR-0005 bypass).
- Fresh `correlationId` per job envelope (`randomUUID`).
- TA: `timeframe: '1D'` (match contracts / JobBus TA discriminator).
- FA: `period: 'quarterly'`.
- `asOf`: enqueue wall time ISO (feeds JobBus hour-bucket jobId today;
  eligibility skip uses **calendar day**, see below).
- Payload symbol = Bursa `stockCode` (HTTP key); worker map owns Yahoo /
  fact assembly from that.

### 3. Skip rule + BullMQ dedup

- **Normal run:** skip a `(stockCode, jobName)` when the analysis row exists
  with `status ∈ {ready, facts_only}` **and** `as_of` (fallback `updated_at`)
  is the **same UTC calendar day** as now.
- Still enqueue for missing / `pending` / `running` / `failed` / `stale`.
- **`--force`:** never skip on row status (still subject to BullMQ in-flight
  collapse via `JobBus.deriveJobId`).
- BullMQ jobId remains the existing content-derived form
  (`ta-{symbol}-1D-{hourBucket}` / `fa-{symbol}-quarterly-{hourBucket}`) —
  that collapses concurrent duplicates; the **day skip** is the cost bound
  (same lesson as prospectus: completed jobs expire from the queue).

### 4. Pending row on enqueue

- Before/with each successful `JobBus.enqueue`, Nest **upserts** the matching
  `technical_analyses` / `fundamental_analyses` row to `pending` (sets
  `correlation_id` / `job_id`; clears stale error/headline/artifact only on
  fresh attempts — build detail).
- Transition to `running` when progress/active is observed (ticket 04 hook).
- This is the deliberate break from prospectus “no row until success”.

### 5. Cadence

- **CLI is the panel checklist** (after `seed-klci` / `ingest-klci`).
- When yfinance DI is bound, **nightly ingest success also calls the same
  enqueue path** (same skip rules) so overnight analyses refresh without an
  operator.
- No browser `@RequiresJob` in PoC.

### Unblocks

- Ticket 06 thin-read pending/running mapping.
- Handoff ops + JobBus section.
- Demo script step 3 in ticket 03.
