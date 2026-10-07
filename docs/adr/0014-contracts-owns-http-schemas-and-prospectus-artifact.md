# ADR-0014: `@tuju/contracts` owns HTTP response schemas; the prospectus artifact moves to Zod

- Status: Accepted
- Date: 2026-10-07
- Deciders: Bursa platform frontend-foundation effort (`.scratch/frontend-foundation/spec.md`)
- Context ticket: `.scratch/frontend-foundation/issues/00-adr-0014-contracts-http-and-artifact.md`
- Spec: `.scratch/frontend-foundation/spec.md`
- Builds on: [ADR-0002](0002-monorepo-pnpm-turborepo-python-own-world.md) (`packages/contracts` is the single cross-language seam), [ADR-0004](0004-data-layer-postgres-typeorm-hybrid-ingestion-s3-claimcheck.md) (S3 claim-check; artifacts proxied by NestJS), [ADR-0007](0007-job-result-progress-contract-bullmq.md) (job/result/progress contract), [ADR-0008](0008-cicd-github-actions-ecr-manual-deploy.md) (Zod-first contracts; check-in generated code; drift gate — **its package scope is widened here, not edited in place**), [ADR-0011](0011-testing-strategy-per-service-testcontainers-contract-goldens.md) (contract goldens), [ADR-0013](0013-system-triggered-ai-jobs-additive-adr-0007-amendment.md) (prospectus job, artifact and `/at-a-glance` endpoints)

## Context

ADR-0007 and ADR-0008 made `@tuju/contracts` the Zod-first source of truth for one
thing: the **JobBus messages** (`JobEnvelope`, `JobResult`, `JobProgress`,
`JobFailure`, payloads, enums). Everything that package exports today crosses the
TS/Python boundary. Nothing in it describes what the backend returns over HTTP.

The frontend foundation effort adds a typed API layer under every Product A page.
That exposes two gaps:

- **HTTP response shapes have no shared home.** The backend read endpoints
  (`apps/backend`) describe their responses in local `*.types.ts` files
  (`market.types.ts`, `stocks.types.ts`, `disclosures.types.ts`). A frontend that
  wants typed queries would have to copy them, and two hand-kept copies drift.
- **The prospectus at-a-glance artifact has no schema at all.** The worker
  assembles it as a plain dict (`services/ai/src/tuju_ai/prospectus/analysis.py`,
  the return value of the analysis function: `schemaVersion`, `prospectusId`,
  `provenance`, `company`, `headline`, `sections`, `insights`, `cost`), writes it
  to S3, and NestJS proxies it to the browser at
  `GET /ipo/:prospectusId/at-a-glance/artifact` (ADR-0013 §11). The only typed
  pieces are the per-section lenient models in `analysis_models.py`, which exist
  to parse raw LLM replies, not to describe the wire shape. The frontend would
  have to hand-write a third description of a document the Python side produces.

Decision inputs:

- ADR-0002 already names cross-language drift as the top structural risk, and
  ADR-0008 already provides the Zod-first pipeline and the regenerate-and-diff
  gate that addresses it. Reusing that pipeline costs nothing new.
- The `jsonSchema.ts` codegen path serializes the whole Zod global registry
  (`z.toJSONSchema(z.globalRegistry)`): any schema given `.meta({ id })` lands in
  the emitted JSON Schema and so in the generated Python, and `modelOrder` is the
  canonical list of those names. Adding HTTP schemas to the package must not drag
  unrelated models into the worker.
- The `analysis_models.py` models do real work that generated models cannot:
  coercion of messy LLM output, sorting, and truncation.

## Decision

### 1. `@tuju/contracts` also owns the HTTP response shapes of the backend read endpoints

The package now exports **Zod schemas for the HTTP responses** of the backend read
endpoints, alongside the JobBus schemas. TS types are inferred from them
natively (`z.infer`), as in ADR-0008.

- The **frontend and the backend both import these**; neither keeps its own copy.
- This **widens the scope ADR-0008 gave the package** (job messages only). The
  Zod-first rule, the leaf-package boundary (no dependency on any workspace
  member) and the "never import across languages" rule are unchanged.

### 2. HTTP schemas are not registered for the Python codegen

The HTTP response schemas are **not** added to `modelOrder` and **do not carry a
`.meta({ id })` registration**, so they never reach `contracts.schema.json` or
`contracts_generated/`. The AI worker gets no models it does not use, and a
change to an HTTP response shape does not alter the generated Python output or
trip the ADR-0008 drift gate.

### 3. The prospectus at-a-glance artifact becomes a Zod schema, with a generated Pydantic model

`ProspectusArtifact` is added to `@tuju/contracts` as a Zod schema describing the
artifact the worker writes to S3 and NestJS proxies to the browser. Unlike the
HTTP schemas, it **is** registered (added to `modelOrder`), so a Pydantic v2 model
is generated into `contracts_generated/` by the existing pipeline (committed,
drift-gated, do-not-hand-edit — ADR-0008).

Both sides consume the one definition: the worker to validate what it produces,
the frontend (via the HTTP layer) to type what it renders.

The worker **validates the assembled artifact against the generated model before
writing it to S3**. A malformed artifact is caught at the producer, not at the
browser. Validation is on the assembled dict only; nothing about how the worker
reaches that dict changes.

### 4. The lenient LLM-output models stay hand-written

`services/ai/src/tuju_ai/prospectus/analysis_models.py` is **not** replaced. Those
models parse **raw LLM replies** and must be tolerant: coerce loosely-typed values,
sort, truncate. Generated models are strict mirrors of the wire contract and
cannot do that. They are an internal parsing stage **upstream** of the artifact,
not part of the wire contract, and they stay Python-only.

The resulting split:

| Layer | Owner | Behaviour |
| ----- | ----- | --------- |
| Raw LLM reply → section data | `analysis_models.py` (hand-written) | lenient: coerce, sort, truncate |
| Assembled artifact → S3 | `ProspectusArtifact` (Zod → generated Pydantic) | strict: validate before write |
| Backend HTTP responses → browser | HTTP Zod schemas in `@tuju/contracts` | strict: the shape consumers import |

### 5. The backend replaces its local `*.types.ts` with the contracts types

`apps/backend` drops its local response types (`market.types.ts`,
`stocks.types.ts`, `disclosures.types.ts`, and any other local HTTP response
type) in favour of the contracts types, and types its controller return values
with them. The contracts type becomes the single compile-time check that the
controller and the frontend agree.

## Consequences

- **Good:** one definition per HTTP response and per artifact; the backend
  controller, the frontend query layer and (for the artifact) the AI worker all
  compile or validate against the same source. Contract changes land in one
  place instead of three.
- **Contracts becomes a dependency of the frontend bundle.** By default this is
  **types only** (no runtime cost). The runtime Zod schemas are used for
  **dev/test response validation**; whether validation also stays on in
  production builds is a frontend decision (frontend-foundation spec, open
  question), not fixed here.
- **A contract change now touches backend, frontend and AI together.** That is
  the point, but it also means a change to `ProspectusArtifact` must update the
  worker's assembly and the frontend's rendering in the same change, and a change
  to an HTTP schema must keep the controller compiling. The compiler and the
  ADR-0008 drift gate (for registered models) carry that load.
- **The backend's imports from `@tuju/contracts` stay `import type`.** The
  package is ESM-only while `apps/backend` compiles to CommonJS (ADR-0013,
  Consequences); a value-level import throws `ERR_PACKAGE_PATH_NOT_EXPORTED`.
  Replacing `*.types.ts` with contracts types works under that rule because
  types are all the backend needs. Backend-side runtime validation with the Zod
  schemas is not part of this decision and would need a CJS build first.
- **Registration is by convention, not enforced by type.** Keeping HTTP schemas
  out of the codegen depends on not calling `.meta({ id })` on them and not adding
  them to `modelOrder`. `buildJsonSchema` serializes the whole global registry
  (it does not consult `modelOrder`), so an accidental `.meta({ id })` on an HTTP
  schema would reach the Python output. The drift gate would flag it as a diff,
  which is the backstop.
- **Artifact versioning is unchanged.** The artifact already carries
  `schemaVersion`; `ProspectusArtifact` describes that version. Artifacts
  already written to S3 under an older shape are not migrated by this ADR.
- **The lenient models and the artifact schema can still drift from each
  other.** `analysis_models.py` output is dumped into `sections.*.data`;
  nothing ties a lenient model's fields to the artifact schema except the
  pre-write validation in §3, which is exactly what makes that drift fail loudly
  at the worker instead of at the browser.

## Out of scope

- The **HTTP schemas themselves** (which endpoints, which fields) — defined in
  the frontend-foundation tickets, not here.
- **Request-body and query-parameter schemas.** This ADR covers responses.
- **A CJS build of `@tuju/contracts`**, and with it runtime use of the Zod
  schemas inside the backend.
- **Shared cross-language job-id constants** (still deferred, ADR-0013).
- **Changing how the worker produces section data** from LLM replies.
- **Tailwind/shadcn and the design tokens.** Those are recorded in
  `apps/frontend/DESIGN.md`, not in an ADR.

## Alternatives considered

- **Keep response types in `apps/backend` and copy them into the frontend.**
  Rejected: two hand-kept copies of every response shape, with drift as the only
  failure signal. It is the exact problem ADR-0002 and ADR-0008 built the
  contracts package to prevent.
- **A separate package for HTTP schemas** (e.g. `@tuju/api-types`). Rejected: a
  second leaf package to build, version and wire through Turbo for a handful of
  files, while the Zod tooling, test setup and `workspace:*` consumption already
  exist in `@tuju/contracts`. The cost is a wider package scope, which this ADR
  records.
- **Register the HTTP schemas for Python codegen too.** Rejected: the AI worker
  never reads these endpoints. It would add unused generated models and make
  unrelated HTTP changes show up as Python drift.
- **Leave the artifact as a hand-written Pydantic model on the Python side and
  mirror it in the frontend.** Rejected: that is a cross-language hand-sync with
  no compiler help, the same risk ADR-0013 accepted for job ids only because it
  was three string prefixes. An artifact with five sections is not that.
- **Replace `analysis_models.py` with generated models.** Rejected: generated
  models mirror the wire shape and reject bad input; the LLM-parsing stage needs
  to accept bad input and repair it (§4).
- **Validate the artifact in NestJS when proxying it instead of in the worker.**
  Rejected: the backend is `import type` only against contracts (ESM/CJS), and
  catching a bad artifact after it is already in S3 is later and more expensive
  than refusing to write it.
