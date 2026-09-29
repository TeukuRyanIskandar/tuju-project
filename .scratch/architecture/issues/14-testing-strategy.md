# Decide: per-service testing strategy (three services + the contract seam)

Type: grilling
Status: resolved
Blocked by: (none)

## Question

Decide the testing strategy across the monorepo — the test layers, tooling, and
fixtures each service uses, and how the cross-language contract is tested — enough
that an executor scaffolds each service with its test setup in place.

Structural context:
- **Two-world repo** (ADR-0002): TS half (Jest/Vitest territory) + separate
  uv-managed Python world (pytest territory). Testing must respect that boundary.
- **Contract seam** (ADR-0007 / `packages/contracts`): the single schema source →
  TS + Python. Contract tests (does each side conform to the generated types?) are
  the highest-value cross-language test and pair with the CI drift guard (ticket 11).
- **JobBus + queue** (ADR-0001/0007): jobs are idempotent/re-runnable; testing the
  enqueue→process→result path (incl. failure classes/retries) matters.
- **Data seam** (ADR-0004): NestJS sole Postgres writer, Python stateless reader —
  tests can seed Postgres with fixtures and the Python module reads them.

Must settle:

- **Test layers per service**: unit / integration / (any) e2e for `apps/backend`,
  `apps/frontend`, `services/ai` — and which are launch-required vs deferred.
- **Tooling** for each world (TS runner; pytest config) and how they run in CI
  (coordinate with ticket 11's stages).
- **Contract testing**: how conformance to `packages/contracts` is asserted on both
  sides so drift fails a test, not production.
- **Fixtures / test data**: KLSE fixture data for TA/FA and dashboard tests — note
  this leans on the **separate dev/prototype data-posture wayfinder effort** (which
  owns the fixtures-vs-live decision); this ticket consumes that output, it does not
  decide it.
- **Queue/DB in tests**: real (testcontainers/LocalStack) vs mocked, per layer.

Output: an ADR recording the test layers, per-world tooling, the contract-test
approach, and the fixture strategy (referencing the dev-data effort).

## Notes

Graduated from the map's "Not yet specified" fog. On the architecture critical path.
**Soft cross-effort dependency**: fixture sourcing is owned by the separate
dev/prototype data-posture wayfinder effort — this ticket references it, doesn't
re-decide it. Independent of the other three graduated tickets within this map.
Consult `grilling` + `domain-modeling`.


## Answer

**Per-service testing strategy pinned — [ADR-0011](../../../docs/adr/0011-testing-strategy-per-service-testcontainers-contract-goldens.md).** Resolved via HITL grilling.

- **Layers:** unit + contract launch-required on all three services; integration launch-required only on the two highest-risk seams (JobBus enqueue→process→result incl. failure classes/retries, and NestJS→Postgres data layer); **frontend e2e (Playwright) deferred entirely** post-launch (costliest layer; warm ~500-user audience tolerates a manual smoke-test over a delayed launch).
- **Runners — per-app home turf:** **Jest** for NestJS backend, **Vitest** for TanStack Start frontend, **pytest** for Python (separate CI job outside the Turbo graph per ADR-0002). Two TS configs accepted; single-runner-everywhere rejected to avoid running NestJS off its supported path.
- **Contract testing:** the ADR-0008 drift gate (static: generated == source) **plus runtime golden fixtures in `packages/contracts`** — canonical `JobEnvelope` + result payloads both sides load and validate (Zod on NestJS, generated Pydantic on Python). Catches type-valid-but-wrong-shape boundary payloads the drift gate can't.
- **Queue/DB in tests:** **mock at unit** (stub JobBus, fixture DataFrames, fake sessions); **real infra via testcontainers at integration** (Redis + Postgres + LocalStack = the same ADR-0006 compose stack). Chosen because the decided behaviors worth trusting — ADR-0007 retry/backoff/DLQ (real Redis) and ADR-0004 sole-writer invariant — are exactly what mocks silently get wrong. Docker-in-CI now a hard requirement of the integration lane (GH Actions runners have it).
- **Fixtures — boundary:** this ticket owns contract/structural fixtures (goldens, Postgres seed rows) + the harness; the **separate dev/prototype data-posture wayfinder effort owns market-fixture sourcing + licence posture**. Interface = "a fixture file exists at a known path." **TA/FA market-realism tests are skippable-with-a-marker** (`skipif no-fixtures`) until that effort delivers — soft, non-blocking cross-effort dependency.

**No new fog.** This was the last frontier ticket → the map reaches its destination: all architecture ADRs (0001–0011) locked, nothing left to decide before scaffold execution.
