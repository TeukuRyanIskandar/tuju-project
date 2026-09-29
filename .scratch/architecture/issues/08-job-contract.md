# Decide: the job / result / progress contract over BullMQ

Type: grilling
Status: resolved
Blocked by: 02

## Question

Now that the broker is locked to **Redis + BullMQ** with a `JobBus` abstraction (ADR-0001), define the concrete contract the NestJS producer and the Python/LangGraph worker share.

Must settle:

- **Job envelope:** the job types Product A dispatches (TA, FA, IPO/prospectus doc analysis, …) and the payload shape for each — what NestJS puts on the queue.
- **Progress schema:** what a `updateProgress(...)` payload carries so the UI can render streaming LangGraph step updates (e.g. phase, percent, human-readable step label), and how it flows to the frontend.
- **Result shape:** what a completed job returns (`job.returnvalue` vs a dedicated results queue) and how large results (doc-analysis output) are handed off — inline vs. a pointer to storage.
- **Failure semantics:** retry/backoff policy, what counts as a dead-letter, and how the UI is told a job failed.
- **The `JobBus` interface itself** on each side (NestJS `enqueue`/`onProgress`/`onResult`; Python `consume`/`reportProgress`), kept implementation-agnostic per ADR-0001.

Output: an ADR under `docs/adr/` recording the contract. Depends on the data-layer decision only insofar as large-result storage may reference it — coordinate, don't block.


## Answer

Contract pinned in [ADR-0007](../../docs/adr/0007-job-result-progress-contract-bullmq.md).
All schemas are the single source in `packages/contracts`, generating both TS
(NestJS) and Python (worker) per ADR-0002, kept narrow/stable to neutralize the
cross-language drift risk.

- **Job types (v1):** TA and FA only, as **two independent job names**
  (`analyze-technical`, `analyze-fundamental`) on the `analysis` queue —
  independently dispatchable/re-runnable. Doc analysis **not** forward-declared
  (~6+ months out, likely to churn); added additively later.
- **Two ids:** internal content-derived `jobId` (BullMQ dedup key,
  `ta:{symbol}:{timeframe}:{asOfBucket}`) collapses duplicate concurrent requests;
  client-facing `correlationId` (UUID, per request) fans out progress/result/
  failure to all subscribers on a collapsed job.
- **Envelope:** generic `JobEnvelope<P>` = `{ correlationId, requestedBy (userId |
  'system'), trigger ('user' | 'price-move'), asOf, payload }`; per-job payloads
  are independent (`TechnicalPayload { symbol, timeframe, indicators? }`,
  `FundamentalPayload { symbol, period }`).
- **Progress:** step-based (`{ stepIndex, stepTotal|null, phase, label, at }`), **no
  percent**; `phase` is a **fixed enum per job type** (Python emits known phases,
  FE localizes).
- **Result:** `job.returnvalue` (no dedicated results queue — payload is in S3,
  Postgres is the durable record). `JobResult` = claim-check `pointer { bucket, key,
  sha256, bytes, contentType }` + **thin stable `summary { verdict (enum), headline,
  asOf }`** (Option A). All rich analysis lives in the **opaque S3 artifact**.
- **Failure:** two classes — retryable/transient (**3 attempts, 5s → 15s → 30s**) vs
  terminal (fail-fast, no retry; worker can signal "don't retry"). UI told via
  `JobFailure { correlationId, jobId, failureClass, retryable, userMessage, at }`.
- **Retention:** `removeOnComplete { age: 1h }`, `removeOnFail { age: 24h }`.
- **`JobBus` signatures** pinned on both sides (NestJS `enqueue`/`onProgress`/
  `onResult`/`onFailure`; Python `consume`/`reportProgress` + terminal-error =
  no-retry).

**Scope ruled out (→ map Out-of-scope):** the concrete TA/FA **indicator & metric
set** and the **internal JSON shape of the S3 artifact** — product content decided
with the product partner as a separate later feature effort. The contract treats the
artifact as opaque, so that work never changes the wire contract, does not block, and
is not part of this architecture map's destination.
