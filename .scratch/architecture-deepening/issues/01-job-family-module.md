# Job family module: identity + landing + in-memory JobBus

Status: resolved
Strength: Strong
Dependency category: local-substitutable (Redis testcontainer, InMemoryJobBus)
Blocked by: 00, 07
Supersedes: .scratch/architecture-review/issues/03

## Files
- `apps/backend/src/jobbus/job-bus.service.ts` (`deriveJobId`, `getQueue`)
- `jobbus/job-id-formats.ts`, `jobbus/job-result-helpers.ts`
- `analysis/stock-analysis.upsert.ts`, `ipo/ipo.mapping.ts`
- The six result stores: `analysis/{technical,fundamental}-analysis.store.ts`, `analysis/analysis-result.store.ts`, `disclosures/announcement-summary.store.ts`, `brief/market-brief.store.ts`, `ipo/prospectus-analysis.store.ts`
- `ingestion/{klci,prospectus}-enqueue.service.ts` (`getQueue().getJob/getState/remove` blocks, `taFaBullJobId`)

## Problem
A job family's identity is defined in up to 4 places. Every result is broadcast to 6 stores, and each one sniffs the id prefix. **Live bug:** the TA/FA bull id `ta:SYM:1D:T05` has 4 colon parts, so BullMQ 5 throws `Custom Id cannot contain :`. The int-spec at `job-bus.int-spec.ts:121` asserts the broken form.

## Direction
- One `JobFamily` per JobName owns `bullId(env)` (BullMQ-legal hyphen form), `ownsResult(jobId)`/`parseResultId`, `land(result)` and `fail(failure)`. Prefixes come from the 07 registry.
- JobBus dispatches each result or failure to exactly one family.
- TA and FA become one parameterised stock-analysis family.
- JobBus gains `enqueue(job, env, { replaceFinished })` returning `{ jobId, status: 'enqueued' | 'inFlight' }`, so the ingestion enqueue services stop calling `getQueue()`. `getQueue()` remains only for Bull-Board.
- Add `InMemoryJobBus` as a second adapter for unit tests.

## Tests
- A table-driven spec per family: the bull id passes BullMQ's own validation, the result id round-trips, and landing writes the row.
- The JobBus int-spec covers in-flight/replace semantics.
- Enqueue services are tested against `InMemoryJobBus`.

## Comments

**2026-10-12, implemented (uncommitted on `refactor/architecture-deepening`).**

- `jobbus/job-family.ts`: `JobIdentity` (`key(env)`, `bullId`, `resultId`, `parseResultId`) and `JobFamily` (`identity`, `land(result, ref)`, `fail(failure, ref)`), plus `EnqueueOptions`/`EnqueueOutcome`.
- `jobbus/job-identities.ts`: every family's identity in one table (`JOB_IDENTITIES`, exhaustive over `JobName`), result prefixes pinned to the 07 registry via `ResultIdPrefix<N>`; helpers `bullIdFor`, `resultIdFor`, `resolveResultId`. TA/FA bull ids are now `ta-1155-1D-2026-10-08T18` (fixes `Custom Id cannot contain :`); result ids unchanged.
- `JobBus` is now the abstract seam (and Nest token). `register(family)` allows one family per job name; results route by result id, final failures by the BullMQ job's name + envelope (no bull-id parsing). Families may throw; the bus logs. `onResult`/`onFailure` kept as ADR-0007 §8 observers only. Adapters: `BullMqJobBus` (production; `getQueue()` lives only here, for Bull-Board) and `InMemoryJobBus` (unit tests).
- `enqueue(job, env, { replaceFinished })` → `{ jobId, status: 'enqueued' | 'inFlight' | 'finished' }`. Deviation: a third status, `finished`, because without `replaceFinished` a retained completed/failed job really does swallow the add (the brief/announcement same-day collapse) and calling that `inFlight` would be false.
- Deviation: identity and landing are split. Identity is pure and always available (the ingestion worker enqueues brief/ann/prospectus without importing their modules); landing is registered per process, so which process lands what is unchanged.
- TA+FA merged into `analysis/stock-analysis.store.ts` (`StockAnalysisStore`: `findByInstrumentId(job, id)`, `markPending(job, id, {correlationId, jobId})`, `land`, `fail`). A verdict-bearing result (scaffold `POST /analysis`, still live) is routed to `AnalysisResultStore.persist`, which no longer subscribes itself. The stub worker now returns the colon result id.
- Deleted: `jobbus/job-id-formats.ts`, `jobbus/job-result-helpers.ts`, `analysis/stock-analysis.upsert.ts`, `analysis/{technical,fundamental}-analysis.store.ts`, `ipo.mapping.ts`'s prefix + `prospectusIdFromJobId`, `klci-enqueue`'s `taFaBullJobId`, `JobBus.deriveJobId`/`prospectusBullJobId`.
- Tests: `jobbus/job-identities.spec.ts` (table per JobName: BullMQ's own `validateOptions`, result-id round trip, golden fixtures), `jobbus/job-bus.spec.ts` (routing + enqueue semantics via `InMemoryJobBus`), `analysis/stock-analysis.store.spec.ts` (landing through the bus), enqueue services against `InMemoryJobBus`; `job-bus.int-spec.ts` now covers hyphen ids, every family's id on a real `Queue.add`, in-flight/finished/replace, and failure routing.
- Not done (other tickets): failure classification still reports `transient_exhausted` for an `UnrecoverableError` (BullMQ's `failedReason` is the bare message) — architecture-review 01. ADR-0013's table still names `JobBus.deriveJobId` (outside apps/backend).
- Verified: typecheck/lint clean; unit 39/39 suites (397 tests); int 16/16 suites (174 tests).

