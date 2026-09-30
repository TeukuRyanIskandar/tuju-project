# free-tier-data — execution effort (spec 01 implementation)

Breaking [spec 01 — data ingestion + domain model](../free-tier-specs/01-data-ingestion-and-domain-model.md)
into build tickets. Backend only. Ticket work lands in `apps/backend`.

## Ticket status

| # | Ticket | Wave | Blocked by | Status |
| - | ------ | ---- | ---------- | ------ |
| 01 | [Domain model foundation (entities + migration)](issues/01-domain-model-foundation.md) | — | — | **resolved** (committed `3b0b2bf`) |
| 02 | [Source-adapter seam](issues/02-source-adapter-seam.md) | 1 | 01 | **resolved** (working tree, uncommitted) |
| 03 | [Synthetic co-generation generator](issues/03-synthetic-cogeneration-generator.md) | 1 | 01 | **resolved** (working tree, uncommitted) |
| 04 | [Ingestion worker + indicators + ADR-0012](issues/04-ingestion-worker-and-indicators.md) | 2 | 02, 03 | **open** |

## Wave structure

- **Wave 1 (done):** ticket 02 (adapter seam) ∥ ticket 03 (synthetic generator) — both
  depend only on ticket 01's entities and were implemented in parallel by fresh-context
  sub-agents, then independently audited (both PASS).
- **Wave 2 (next):** ticket 04 — the integration join point. Wires the demo adapters
  (02) onto `@nestjs/schedule` crons in a dedicated NestJS ingestion worker process,
  delegates synthetic price/fundamentals to the generator (03), computes indicators in
  TypeScript, materialises ratios, implements the decision-B purge. **ADR-0012 is
  written here.** Needs testcontainers (Postgres + Redis).

## Decisions / notes so far

- Wave-1 code lives in two new dirs, no overlap: `apps/backend/src/data/adapters/`
  (seam) and `apps/backend/src/data/synthetic/` (generator). Entities + migration
  untouched.
- Generator is a pure, deterministic, seeded module (splitmix32/mulberry32/GBM); its
  reconciliation test recomputes every ratio from emitted DTOs and asserts agreement
  (the A1 guarantee), including P/NTA ≠ P/B via an intangibles line.
- Adapter seam: one interface per data class + demo impls behind DI tokens; the
  `SyntheticMarketDataAdapter`/`FundamentalsAdapter` are thin and will delegate to the
  generator when the worker (04) wires them.
- **Verification at end of Wave 1:** `pnpm --filter @tuju/backend test` → 86/86 pass
  (8 suites); `typecheck` clean. Independent auditor confirmed scope isolation + no
  git commit.
- **Uncommitted:** Wave-1 changes are in the working tree only (not committed), pending
  your review.

## Not yet ticketed (still spec-01 scope, deferred by ticket 01)

None beyond ticket 04 — 02/03/04 cover the remaining spec-01 "Out of scope" list
(seam, generator, worker/indicators/purge/ADR-0012). Specs 02–06 are separate efforts.
