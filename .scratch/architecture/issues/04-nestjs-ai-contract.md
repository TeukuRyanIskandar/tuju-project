# Decide: NestJS ↔ AI module transport topology (async-only vs. hybrid sync path)

Type: grilling
Status: resolved
Blocked by: 02

## Question

**Reframed (2026-09-28):** This ticket originally spanned the full NestJS↔AI contract + job lifecycle. After ticket 02 closed, the concrete job/result/progress contract graduated into its own sharper ticket — "Decide: the job / result / progress contract over BullMQ" (issues/08-job-contract.md) — which now owns the job envelope, progress schema, result shape, failure semantics, and the `JobBus` interface. To keep each decision in exactly one place, ticket 04 is narrowed to the one upstream question 08 does **not** cover, and which *shapes* 08:

**Is every NestJS→AI interaction async-over-the-queue, or does any class of AI work warrant a synchronous request/response path (HTTP/gRPC) alongside the BullMQ queue?**

Must settle:

- Whether all AI work for Product A (TA, FA, IPO/prospectus doc analysis) is coarse/slow enough to be exclusively queue-based async, OR whether there's a fast/cheap/interactive class of AI query that a synchronous call serves better (latency, UX, simplicity).
- If hybrid: the boundary rule — what goes sync vs. async — stated crisply enough that ticket 08 (queue contract) and later executors know which path a new job type takes.
- The cost of a second transport (a sync HTTP surface on the Python side) vs. the cost of forcing fast queries through the queue.
- That the answer doesn't preclude Product C's heavy-compute jobs (a force, not a design here).

Output: an ADR recording the transport topology (async-only vs. hybrid + the boundary rule). Upstream of ticket 08's concrete queue contract.

## Answer

**Decision: async-only over BullMQ for v1; a synchronous NestJS→AI path is deliberately deferred.** Locked as [ADR-0003](../../../docs/adr/0003-async-only-transport-sync-deferred.md).

Deciding inputs from the HITL session:

- **v1 is TA/FA only** (doc analysis deferred and unambiguously async). TA/FA has **two triggers** — user-click and **system-triggered by sudden price moves** ("explain this movement") — running the *same* pipeline.
- The **price-movement trigger is inherently a background job** (no user waiting), so async is *mandatory* for at least one trigger regardless of latency.
- **Latency is unmeasured** (nothing built), but TA/FA drafts an LLM explanation, so sub-second is unlikely; a streaming "working… (live steps)" UX beats a blocking wait for an AI answer.
- The **deciding argument** (raised by the user): the AI module has a real failure profile, so async is better *because it fails* — BullMQ gives retry/backoff, DLQ, and idempotent re-runs for free (ADR-0001); a sync call has none of that.

Resolution: both triggers **enqueue the same TA/FA job**; the UI subscribes to BullMQ progress events for streaming LangGraph steps. Sync is added later **only if** a measured, genuinely sub-second, user-blocking AI surface appears (none today) — additive via a FastAPI route beside the worker, without disturbing the queue contract or the `JobBus` seam.

Downstream: this fixes the topology **upstream of ticket 08** (job/result/progress contract over BullMQ) — 08 now defines the single async contract knowing there is no competing sync path. No new tickets or fog graduated; no scope changes.
