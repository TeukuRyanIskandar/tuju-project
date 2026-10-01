# free-tier-data — execution effort (spec 01 implementation)

Breaking [spec 01 — data ingestion + domain model](../free-tier-specs/01-data-ingestion-and-domain-model.md)
into build tickets. Backend only. Ticket work lands in `apps/backend`.

## Ticket status

| # | Ticket | Wave | Blocked by | Status |
| - | ------ | ---- | ---------- | ------ |
| 01 | [Domain model foundation (entities + migration)](issues/01-domain-model-foundation.md) | — | — | **resolved** (committed `3b0b2bf`) |
| 02 | [Source-adapter seam](issues/02-source-adapter-seam.md) | 1 | 01 | **resolved** (committed `7b10846`) |
| 03 | [Synthetic co-generation generator](issues/03-synthetic-cogeneration-generator.md) | 1 | 01 | **resolved** (committed `7b10846`) |
| 04 | [Ingestion worker + indicators + ADR-0012](issues/04-ingestion-worker-and-indicators.md) | 2 | 02, 03 | **resolved** (committed `7b10846`; post-review fixes `7fc11ab`) |
| 05 | [Nightly re-ingest idempotency](issues/05-nightly-reingest-idempotency.md) | — | — | **open** (filed from spec-02 effort findings) |

## Wave structure

- **Wave 1 (done):** ticket 02 (adapter seam) ∥ ticket 03 (synthetic generator) — both
  depend only on ticket 01's entities and were implemented in parallel by fresh-context
  sub-agents, then independently audited (both PASS).
- **Wave 2 (done):** ticket 04 — the integration join point. Wires the demo adapters
  (02) onto `@nestjs/schedule` crons in a dedicated NestJS ingestion worker process,
  delegates synthetic price/fundamentals to the generator (03), computes indicators in
  TypeScript, materialises ratios, implements the decision-B purge. **ADR-0012 is
  written** (`docs/adr/0012-dedicated-nestjs-ingestion-worker-ts-indicators.md`).

## Decisions / notes so far

- Wave-1 code lives in two new dirs, no overlap: `apps/backend/src/data/adapters/`
  (seam) and `apps/backend/src/data/synthetic/` (generator). Entities + migration
  untouched.
- Generator is a pure, deterministic, seeded module (splitmix32/mulberry32/GBM); its
  reconciliation test recomputes every ratio from emitted DTOs and asserts agreement
  (the A1 guarantee), including P/NTA ≠ P/B via an intangibles line.
- Adapter seam: one interface per data class + demo impls behind DI tokens; the
  `SyntheticMarketDataAdapter`/`FundamentalsAdapter` are thin and delegate to the
  generator (wired by ticket 04).
- **Verification at end of Wave 1:** `pnpm --filter @tuju/backend test` → 86/86 pass
  (8 suites); `typecheck` clean. Independent auditor confirmed scope isolation + no
  git commit.
- **Wave 2 (tickets 02–04) committed together** in `7b10846` ("feat(backend):
  free-tier ingestion seam, synthetic generator, worker (spec 01, tickets 02-04)"),
  followed by post-code-review fixes in `7fc11ab` (double-init in the worker serve
  path; ADR-0010 structured-log violation). Final verification at commit time:
  typecheck clean; 96/96 tests (11 suites, testcontainers Postgres + Redis);
  `test:int` 2/2; build clean; `docker compose config` valid.
- **Ticket 05 filed after the fact:** the spec-02 (free-tier-search) cache test
  ran `runNightly()` a second time against a populated DB and found re-ingest is
  not idempotent — see the ticket for the full findings (a `UQ` violation fails the
  whole nightly ingest on every night after the first).

## Not yet ticketed (still spec-01 scope)

Ticket 05 is the only open item on this effort. When it resolves, spec-01 execution
is fully closed. (Its fix may graduate into an ADR-0012 amendment or a fresh ADR if
the regen posture is architectural — the ticket's call to make.)
