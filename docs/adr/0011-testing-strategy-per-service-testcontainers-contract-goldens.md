# Testing strategy: per-service layers, per-world runners, testcontainers at the seams, contract goldens

Status: accepted

## Context

The monorepo must ship with a test setup an executor can scaffold per service,
under the locked structural constraints:

- **Two-world repo** (ADR-0002): TS half (`apps/frontend`, `apps/backend`,
  `packages/contracts`) + a separate uv-managed Python world (`services/ai`).
- **Contract seam** (ADR-0007 / ADR-0008): `packages/contracts` is the single
  schema source (Zod → generated TS types + Python Pydantic), with a CI
  **drift gate** (regenerate, fail on `git diff`) already proving generated code
  matches source. Cross-language contract drift is the ADR-0002 top risk.
- **JobBus + queue** (ADR-0001/0007): idempotent/re-runnable jobs; real
  BullMQ/Redis failure-class + retry/backoff/DLQ behavior.
- **Data seam** (ADR-0004): NestJS sole Postgres writer, Python stateless reader;
  S3 claim-check for AI artifacts.
- **Deploy stack** (ADR-0006): local `docker compose up` = NestJS + Python + Redis
  + Postgres + LocalStack; same containers in prod on EC2.

Consistent map posture: lean for v1, keep the expensive thing a cheap additive
step later.

## Decision

**Test layers — launch-required vs deferred.**
- **Unit + contract tests: launch-required on all three services.**
- **Integration tests: launch-required only on the two highest-risk seams** — the
  JobBus enqueue→process→result path (incl. failure classes/retries) and the
  NestJS→Postgres data layer (sole-writer invariant).
- **Frontend e2e (Playwright): deferred entirely to post-launch.** A warm
  ~500-user early-adopter audience tolerates a manual dashboard smoke-test better
  than a delayed launch; e2e is the costliest layer to write and maintain.

**Per-world runners — home turf, not one runner.**
- **NestJS backend: Jest** (its default; no fighting the framework).
- **TanStack Start frontend: Vitest** (Vite-native).
- **Python `services/ai`: pytest**, configured inside the uv world, run as a
  separate CI job outside the Turbo graph (ADR-0002 boundary).
- Two TS configs (Jest + Vitest) accepted as the cost of each tool on its home
  turf; a single-runner alternative (Vitest everywhere, incl. NestJS) was
  considered and rejected to avoid running NestJS off its supported path.

**Contract testing — drift gate + runtime golden fixtures.**
The ADR-0008 drift gate is a *static* guarantee (generated code == Zod source).
On top of it, **shared golden fixtures live in `packages/contracts`**: canonical
`JobEnvelope` payloads and result payloads that **both sides load and validate**
(NestJS asserts against the Zod schemas; Python asserts against the generated
Pydantic models). This catches what the drift gate cannot — a payload that is
type-valid but the wrong shape at the boundary. Drift gate + goldens together are
the cross-language safety net; a real boundary shape mismatch fails a test, not
production.

**Queue/DB in tests — mock at unit, real infra at integration.**
- **Unit layer: mock dependencies** (stub `JobBus`, fixture DataFrames for Python
  TA/FA, fake sessions for guards). Fast, no Docker, runs constantly.
- **Integration layer: real infra via testcontainers** — programmatically spun-up
  throwaway Redis + Postgres + LocalStack (S3), the *same stack* ADR-0006 runs in
  compose. Chosen over mocking-at-integration because the highest-value decided
  behaviors — ADR-0007 failure classes/retry/backoff/DLQ (real Redis+Lua) and the
  ADR-0004 sole-writer invariant + Postgres SQL/transactions — are precisely what a
  mock silently gets wrong. Cost accepted: slower suite + Docker-in-CI (GitHub
  Actions runners have Docker; the containers match dev/prod, so no
  "passes-in-test, breaks-in-compose" gap).

**Fixtures — boundary with the dev-data effort.**
- **This ticket owns** the contract/structural fixtures (the `packages/contracts`
  goldens above, generic Postgres seed rows) and the **test harness** that loads
  fixtures.
- **The separate dev/prototype data-posture wayfinder effort owns** the *sourcing*
  and *licence posture* of realistic KLSE market-data fixtures (price series,
  fundamentals, sample prospectus PDFs). This ADR treats "a fixture file exists at
  a known path" as its interface.
- **Market-realism-dependent tests (TA/FA) are skippable-with-a-marker**
  (e.g. pytest `skipif no-fixtures`) until that effort delivers. The harness
  scaffolds now; those tests activate when fixtures land — a soft, non-blocking
  cross-effort dependency, matching the map's keep-the-frontier-moving posture.

## Consequences

- **CI stages (coordinate with ADR-0008):** PR lane runs unit + contract on both
  worlds (Vitest + Jest for TS via Turbo; pytest for Python as a parallel job) plus
  the integration suites against testcontainers, alongside the existing drift gate.
- **Docker-in-CI is now a hard CI requirement** for the integration lane
  (testcontainers). Already satisfied by GitHub Actions runners.
- **Golden fixtures become part of the contract surface:** changing a payload shape
  means updating the `packages/contracts` goldens, and both sides' conformance tests
  enforce it — reinforcing the ADR-0007 contract as the single source.
- **TA/FA integration coverage is intentionally dormant at launch** until the
  dev-data effort delivers market fixtures; this is a known, marked gap, not a
  silent one.
- **Escape hatch for e2e:** Playwright over the login→run-analysis→see-result flow
  is the additive post-launch step; deferring it now costs no rework, since the
  integration + contract layers already exercise the seams underneath it.
