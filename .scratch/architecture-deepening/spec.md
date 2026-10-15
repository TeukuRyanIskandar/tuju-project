# Architecture deepening, 2026-10-12

Status: resolved (all tickets 00–08; uncommitted on branch)
Branch: `refactor/architecture-deepening`
Visual report: [`report.html`](report.html)

This is the output of an `/improve-codebase-architecture` pass over the hot spots since August:
backend ingestion/jobbus/analysis/stocks, the AI worker handlers/prospectus/llm, and contracts.
The user asked for all eight candidates to be worked on. Vocabulary follows `codebase-design`
and each context's `CONTEXT.md`.

It supersedes `.scratch/architecture-review` tickets 03 (single job identity) and 05 (generate
Python name constants). Those are folded into 01 and 07 here. Tickets 01, 02, 04 and 06 of that
review stay open and separate.

## Bugs found while exploring (fixed inside the tickets noted)

| Bug | Fixed in |
| --- | --- |
| TA/FA BullMQ id `ta:SYM:1D:T05` has 4 colon parts, so BullMQ 5 throws `Custom Id cannot contain :` and every TA/FA enqueue fails | 01 |
| 9 testcontainer specs named `*.int.spec.ts` ran in the unit lane and never in `test:int` | 00 (done: renamed, plus `src/test-lane-naming.spec.ts` guard) |
| `AnnouncementSummaryStore` and the TA/FA stores land results without invalidating cached reads, so they are stale for 1–24h | 04 |
| `whatToWatch.derivedFrom` lists 4 sections but the reduce step is fed 6 | 06 |
| TA/FA read `os.environ` directly, hardcode `ceiling_usd=0.10`, and have a production `test-key-for-testing` branch | 03 |
| `_narrate_with_grounding_retry` can reference an unbound `response` | 03 |

## Tickets and order

| # | Ticket | Track | Blocked by |
| -- | --- | --- | --- |
| 07 | [Job registry generated across the contract seam](issues/07-contracts-job-registry.md) | contracts | none |
| 01 | [Job family module (identity + landing + in-memory JobBus)](issues/01-job-family-module.md) | backend | 07 |
| 04 | [ReadModelCache owns keys + invalidation](issues/04-read-model-cache.md) | backend | 01 |
| 05 | [Source adapters self-report provenance; Ingestion run module](issues/05-ingestion-run-provenance.md) | backend | 04 |
| 08 | [Stock analysis module](issues/08-stock-analysis-module.md) | backend | 01, 04 |
| 03 | [One LLM runtime + structured-call module](issues/03-llm-runtime-structured-call.md) | AI | 07 |
| 02 | [Job pipeline module; Handlers become specs](issues/02-job-pipeline.md) | AI | 03 |
| 06 | [At-a-glance analysis as one deep module](issues/06-at-a-glance-module.md) | AI | 02 |

After 07, the backend and AI tracks touch disjoint files and can run in parallel.

## Decisions taken without a grilling pass (the user asked for everything; redirect any)

- **The BullMQ id and the result id are separate concerns.** The BullMQ id must be BullMQ-legal
  (hyphen form, as brief/ann/prospectus already use). The worker's `JobResult.jobId` keeps its
  existing colon form, which is the contract golden. Each Job family owns both and their mapping.
  This reverses code-quality-audit ticket 15's "colon everywhere" for the BullMQ id only.
- **No contract shape changes.** Envelope, result and artifact schemas stay as they are. Only
  metadata (the job registry) is added to `@tuju/contracts`, so ADR-0007 and ADR-0014 hold.
- **Adapter interfaces may change** (ticket 05), because only in-repo adapters implement them.
- **Dead code is deleted** (`graph.py`, `_handle_analysis_job`), and `CONTEXT.md` is updated to
  drop the "LangGraph stub" line. ADR-0003 is not reversed: it allowed a stub and did not require one.
- **Commits are left to the user.** Agents make no commits. Work lands as an uncommitted diff on
  the branch, split by ticket at commit time.

## Outcome (2026-10-12)

All tickets are resolved. Each ticket's `## Comments` has the details. Final verification:

| Lane | Result |
| --- | --- |
| Contracts | 69/69 passed |
| Backend unit | 41/41 suites, 428 tests |
| Backend integration | 18/18 suites, 188 tests |
| AI worker | 209 passed |
| Backend typecheck | clean |
| Frontend typecheck | clean |

Additional production bugs found and fixed along the way:
- `DataModule` couldn't boot the API or the worker (entity metadata missing for `Company#sector`).
- `DataModule` had a drifted migrations list (now a shared `MIGRATIONS`).
- TA/FA status was cached as `pending` for 1h.
- TA/FA grounding exhaustion was terminal instead of degrading to facts-only.
- The demo DY counted rights issues as dividends.
- A fast TA/FA result could be overwritten back to pending.

Open, needing a user decision:
- **`derivedFrom`**: fixing it means widening the `ProspectusWatchSection.derivedFrom` 4-tuple in `artifact.ts`. That is a contract change: regenerate, and possibly bump the schema version.
- **DY on the yfinance path** reads vendor dividends that aren't stored as CorporateAction rows. Making it single-source raises a licence question and changes the numbers.
- **Job failures are still always reported `transient_exhausted`.** This belongs to `.scratch/architecture-review/issues/01`.
- **ADR-0013's table still names `JobBus.deriveJobId`**, which no longer exists.
