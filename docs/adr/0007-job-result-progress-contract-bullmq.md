# ADR-0007: The job / result / progress / failure contract over BullMQ

- Status: Accepted
- Date: 2026-09-28
- Deciders: Bursa platform architecture effort (wayfinder map: Architecture Map — Bursa Platform (Product A))
- Context ticket: `.scratch/architecture/issues/08-job-contract.md`
- Builds on: [ADR-0001](0001-redis-bullmq-nestjs-python-jobbus.md) (Redis + BullMQ behind a `JobBus`), [ADR-0002](0002-monorepo-pnpm-turborepo-python-own-world.md) (`packages/contracts` as the single cross-language schema source), [ADR-0003](0003-async-only-transport-sync-deferred.md) (async-only; both triggers enqueue the same job), [ADR-0004](0004-data-layer-postgres-typeorm-hybrid-ingestion-s3-claimcheck.md) (S3 claim-check: pointer + inline summary)

## Context

ADR-0001 fixed the broker (Redis + BullMQ behind a `JobBus` seam); ADR-0003 fixed
async-only transport with both TA/FA triggers riding the same queue; ADR-0004
fixed that AI results return as an **S3 claim-check pointer + a tiny inline
summary**, with NestJS persisting the pointer to Postgres and proxying reads.

What remained open — and what this ADR fixes — is the **exact field schema** the
NestJS producer and the Python/LangGraph worker share: the job envelope and per-
job payloads, the progress schema, the result/summary schema, the failure
semantics, and the `JobBus` interface signatures on each side.

All schemas defined here are the **single source in `packages/contracts`**,
generating both the TypeScript types (NestJS) and the Python types (worker), per
ADR-0002. Contract drift across the two languages is the flagged top structural
risk; every decision below is shaped to keep the wire contract **narrow and
stable** so that product content can evolve without touching it.

Facts from the deciding session that fixed the answers:

- **v1 ships TA and FA only.** IPO/prospectus doc analysis is ~6+ months out and
  likely to churn, so it is **not** forward-declared in the contract. The
  contract must be *extensible* (adding a job type later must not break existing
  ones) but does not speculate on doc analysis.
- **TA and FA are two independent job types**, independently dispatchable — a
  user can re-run TA against a fresh timeframe without disturbing an existing FA
  result. Their domain payloads stand alone (no shared base *interface* they must
  extend); they share only the generic routing/identity envelope that makes the
  `JobBus` seam generic.
- **The inline summary is thin and structurally stable** (Option A). All rich
  analysis detail (which indicators fired, PE ratio, news, earnings dates, etc.)
  lives in the **S3 artifact**, whose internal JSON shape is **opaque to the
  contract** (owned by the AI module, not `packages/contracts`). The concrete
  indicator/metric set is **out of scope** for this architecture map — it is
  product content decided with the product partner as a separate later effort,
  and because the contract treats the artifact as opaque, that work never changes
  the wire contract.

## Decision

### 1. Queues and job names

Two BullMQ queues, one job name per v1 job type:

- Queue `analysis` carries job names `analyze-technical` and `analyze-fundamental`.
- Adding a job type later = a new job name (and, if warranted, a new queue),
  additively — existing names are untouched.

### 2. Identity — two ids

Every job carries **two distinct ids**:

- **`jobId` (internal, the BullMQ job id):** minted by NestJS,
  **content-derived for idempotency**, e.g. `ta:{symbol}:{timeframe}:{asOfBucket}`
  / `fa:{symbol}:{period}:{asOfBucket}`. BullMQ dedupes on job id, so a user-click
  and a system price-move that request the *same* analysis within the same window
  **collapse to one job** (ADR-0001's idempotent/re-runnable posture pays off
  here). System- and user-triggered jobs are addressed identically.
- **`correlationId` (client-facing, a UUID):** minted per *request*. The frontend
  subscribes to progress/result/failure for **its** `correlationId`. Because one
  `jobId` may serve several requests (dedup collapse), a job **fans out** its
  progress/result/failure to **all** correlation ids registered against it. NestJS
  holds the `correlationId → live SSE/WS connection(s)` registry and the
  `jobId → [correlationId]` fan-out map.

### 3. Job envelope + per-job payloads

A generic outer envelope (routing/identity, uniform for the `JobBus`) wraps a
per-job domain payload:

```
JobEnvelope<P> = {
  correlationId: string   // UUID, client-facing, per request
  requestedBy:   string   // userId, or the literal 'system'
  trigger:       'user' | 'price-move'
  asOf:          string   // ISO-8601 timestamp the analysis is anchored to
  payload:       P        // job-specific, see below
}
```

`jobId` is the BullMQ job id (set at enqueue), not a body field.

Per-job payloads (independent; no shared base interface):

```
TechnicalPayload = {
  symbol:     string             // e.g. "MAYBANK" / Bursa ticker
  timeframe:  '1D' | '1W' | '1M' // v1 set; extend additively
  indicators?: string[]          // optional hint; the resolved set is AI-module content, opaque to the contract
}

FundamentalPayload = {
  symbol: string
  period: 'annual' | 'quarterly'
}
```

The worker is stateless (ADR-0004) and fetches the data it needs from the payload
+ NestJS/data APIs; the payload carries anchoring context, not bulk data.

### 4. Progress schema — step-based, fixed phase enum

`updateProgress(...)` payload (BullMQ native progress → `QueueEvents.on('progress')`):

```
JobProgress = {
  stepIndex:  number          // 0-based
  stepTotal:  number | null   // null when LangGraph can't know the total ahead
  phase:      Phase           // fixed enum per job type (see below)
  label:      string          // human-readable, worker-provided (may be non-localized)
  at:         string          // ISO-8601
}
```

- **Step-based, no percent.** LangGraph step counts can be dynamic/unknown-ahead,
  so a percentage would often be a lie; `stepIndex` + nullable `stepTotal` lets the
  UI render "step 2 of 4" or an indeterminate progress + last label.
- **`phase` is a fixed enum in `packages/contracts`, per job type.** Python must
  emit known phases; the FE can localize them. Free-form phase strings were
  rejected because they can't be localized and invite the exact cross-language
  drift ADR-0002 guards against. `label` remains free-form for detail the enum
  doesn't capture. (Concrete phase enum values are pinned during implementation
  from the LangGraph graph; they are contract-owned once pinned.)

### 5. Result / summary schema — `job.returnvalue`, claim-check, thin summary

The worker returns (via `job.returnvalue` — see §7) a claim-check result:

```
JobResult = {
  correlationId: string
  jobId:         string
  pointer: {                    // the S3 artifact (ADR-0004), full rich analysis
    bucket:      string
    key:         string
    sha256:      string
    bytes:       number
    contentType: string         // e.g. "application/json"
  }
  summary:  Summary             // thin, stable, first-glance (Option A)
  at:       string              // ISO-8601
}
```

- **Thin, stable summary (Option A):** `Summary = { verdict: Verdict, headline: string, asOf: string }`,
  where `Verdict` is a fixed enum (e.g. `'bullish' | 'bearish' | 'neutral'` for TA;
  the FA verdict enum pinned alongside). Deliberately minimal — enough for a
  first-glance render from Redis/Postgres without an S3 round-trip.
- **All rich detail lives in the S3 artifact**, whose internal JSON is **opaque to
  the contract**. Which indicators fired ("200 SMA broke"), PE ratio, news,
  earnings/announcement context, etc. are AI-module product content that can evolve
  freely **without ever changing this wire contract**. This decoupling is the
  reason the indicator/metric set is out of scope for this map (see Consequences).

### 6. Failure semantics — two classes, UI-facing failure event

- **Retry policy:** **3 attempts, exponential-ish backoff `5s → 15s → 30s`** for
  transient failures.
- **Two failure classes:**
  - **Retryable / transient** — LLM timeout, rate limit, flaky upstream data
    fetch → retried with the backoff above.
  - **Terminal** — bad input (unknown symbol) or a worker-rejected bad
    generation → **fail fast, no retry**, straight to failed/DLQ. The worker can
    **signal "do not retry"** (a terminal-error marker BullMQ respects, e.g.
    `UnrecoverableError`) so retries aren't burned on inputs that can never
    succeed.
- **UI notification:** on final failure (retries exhausted, or terminal), NestJS
  emits a failure event to every subscriber on that `correlationId`:

  ```
  JobFailure = {
    correlationId: string
    jobId:         string
    failureClass:  'transient_exhausted' | 'terminal'
    retryable:     boolean   // true ⇒ UI may offer a "try again" button
    userMessage:   string    // safe, human-readable; never a raw stack trace
    at:            string
  }
  ```

### 7. Result hand-off transport — `job.returnvalue`, no dedicated results queue

The worker returns the (small) `JobResult` from its handler; BullMQ stores it on
the job record and NestJS reads it off the `completed` event. **No dedicated
results queue** — that pattern earns its keep only for large payloads or durable
replay / multiple consumers, and ADR-0004 already moved the large payload to S3
while **Postgres (`analysis_results`) is the durable replay store**. On the
`completed` event NestJS persists the pointer + summary to Postgres, then fans the
`JobResult` out to the subscribers.

**Retention guardrail:** `removeOnComplete: { age: 1h }`,
`removeOnFail: { age: 24h }` (failures kept longer for debugging). Redis retention
is only an event-delivery safety margin across a brief restart; Postgres is the
durable record.

### 8. The `JobBus` interface (ADR-0001 seam), pinned

Implementation-agnostic on each side; app code never touches BullMQ directly:

**NestJS (producer):**

```
enqueue<P>(jobName: JobName, env: JobEnvelope<P>): Promise<{ jobId: string }>
onProgress(handler: (p: JobProgress & { jobId: string }) => void): void
onResult(handler: (r: JobResult) => void): void
onFailure(handler: (f: JobFailure) => void): void
```

**Python (worker):**

```
consume(jobName: JobName, handler: (env: JobEnvelope) -> JobResult) -> None
reportProgress(p: JobProgress) -> None
# raising a terminal error from the handler ⇒ no retry (maps to BullMQ UnrecoverableError)
```

## Consequences

**Positive**

- One narrow, stable wire contract in `packages/contracts` generating both
  languages — the single source that neutralizes the flagged cross-language drift
  risk.
- Product content (the indicator/metric set, the rich artifact JSON) evolves
  **independently of the wire contract** — the contract treats the artifact as
  opaque, so the partner-driven indicator decision never forces a contract change.
- Idempotent content-derived `jobId` + fan-out `correlationId` handles duplicate
  concurrent requests cleanly (dedup collapse without losing "who asked").
- Two-class failures avoid burning retries on unrecoverable input and give the FE
  a `retryable` flag to drive a "try again" affordance.
- `job.returnvalue` + Postgres durability keeps the queue lean (no second queue to
  operate); retention is a deliberate, bounded safety margin.

**Negative / risks**

- The `phase` enum and `Verdict` enums must be pinned from the actual LangGraph
  graph during implementation; until then they are named but not enumerated.
  Mitigated by them being contract-owned and additive.
- The thin summary means the FE must fetch the artifact (via the NestJS proxy) for
  any detail beyond verdict + headline; accepted — that is the claim-check design
  (ADR-0004), and artifacts are low-MB.
- NestJS holds in-memory subscriber/fan-out registries (`correlationId → conn`,
  `jobId → [correlationId]`); on the single-EC2 box (ADR-0006) this is fine, but a
  future multi-instance NestJS would need these moved to shared Redis
  pub/sub — noted, not built.

## Amendment: Payload Versioning Strategy (Issue m-11)

**Status:** Proposed; implementation tracked separately.

The current contract lacks a versioning strategy for schema-breaking changes to job payloads. If a required field is added to `TechnicalPayload`, all previously-enqueued jobs fail validation and poison the queue.

### Proposed Design (Option A from m-11)

Add version fields to the job envelope and per-payload type:

```typescript
// packages/contracts/src/events.ts
export const JOB_ENVELOPE_VERSION = '1.0';

export type JobEnvelope<P> = {
  jobId: string;
  correlationId: UUID;
  envelopeVersion: string;        // version the envelope itself
  payloadVersion: string;         // e.g., 'technical-payload-v1' | 'technical-payload-v2'
  payload: P;
  requestedBy: string;
  trigger: 'user' | 'price-move';
  asOf: string;
};

export type TechnicalPayload = {
  symbol: string;
  timeframe: '1D' | '1W' | '1M';
  indicators?: string[];          // new field in v2; optional for backward compat
};
```

**Worker behavior:**

```python
def process_job(envelope: dict) -> JobResult:
    payload_version = envelope.get('payloadVersion', 'technical-payload-v1')
    
    if payload_version == 'technical-payload-v1':
        payload = TechnicalPayloadV1.parse_obj(envelope['payload'])
        # v1 logic
    elif payload_version == 'technical-payload-v2':
        payload = TechnicalPayloadV2.parse_obj(envelope['payload'])
        # v2 logic, possibly with migration from v1 format
    else:
        raise UnrecoverableError(f"Unsupported payload version: {payload_version}")
    
    # Process...
```

**Deployment implications:**

1. Add `payloadVersion` field to `JobEnvelope` in all contexts.
2. Backend sets `payloadVersion = 'technical-payload-v1'` when enqueueing.
3. Worker validates and dispatches based on version.
4. Future breaking changes increment the version string; worker handles both old and new.
5. Enables zero-downtime deploys and easy rollback.

### Short-Term Mitigation (Until Versioning Ships)

Follow **Option B** (backward compatibility) in `docs/ops/queue-deployment-runbook.md`:

- Make all new fields optional with sensible defaults.
- Test with both old and new schemas before merging.
- Deploy worker → wait for queue to drain → deploy backend.
- Fallback: drain the failed queue if poisoning occurs.

### Related Issue

- **Issue m-11:** BullMQ payload migration strategy
- **Runbook:** `docs/ops/queue-deployment-runbook.md` (deployment checklist + incident response)

---

## Out of scope (recorded here, ruled out of the map)

- **The concrete TA/FA indicator & metric set** (e.g. which SMAs, PE ratio, news,
  quarterly-earnings signals) and the **internal JSON shape of the S3 artifact**.
  This is product content decided with the product partner as a separate later
  feature effort; the wire contract treats the artifact as opaque, so this work
  does not block and is not part of the architecture destination.
- **IPO/prospectus doc-analysis job type** — deferred ~6+ months; not forward-
  declared. Added additively when it lands.
- **Versioning implementation details** — see the amendment above and issue m-11.
  Design is pinned here; implementation is deferred.

## Alternatives considered

- **One job type with a `kind: technical | fundamental` field:** rejected — TA and
  FA are independently dispatchable and re-runnable; separate job names keep their
  lifecycles and payloads independent.
- **Rich, structured summary carrying indicator data in the contract (Option B):**
  rejected — it would force the wire contract to enumerate an indicator set that
  isn't decided yet, blocking this ticket on a product decision and coupling the
  contract to churning product content.
- **`percent` progress:** rejected — LangGraph step totals are often unknown ahead,
  making a percentage misleading; step-based with nullable total is honest.
- **Free-form progress `phase` strings:** rejected — un-localizable and drift-prone
  across languages, against ADR-0002.
- **Dedicated results queue:** rejected — unnecessary once the large payload is in
  S3 and Postgres is the durable record; adds an operational surface for no benefit
  at this scale.
- **Single id (jobId only):** rejected — dedup collapse would break the "who asked"
  mapping, so a collapsed job could notify only one subscriber; the `correlationId`
  fan-out fixes this for one extra field.
