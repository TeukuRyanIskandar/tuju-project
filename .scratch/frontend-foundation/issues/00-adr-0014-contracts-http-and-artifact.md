# ADR-0014: contracts owns HTTP response schemas; prospectus artifact moves to Zod

Type: task
Status: done
Blocked by: (none)

## Task

Write `docs/adr/0014-contracts-owns-http-schemas-and-prospectus-artifact.md`,
following the format and tone of the existing ADRs in `docs/adr/`.

Record these decisions:

- `@tuju/contracts` now also owns the HTTP response shapes of the backend read
  endpoints, as Zod schemas. Frontend and backend import them; neither keeps its
  own copy. This widens the scope ADR-0008 gave the package (job messages only).
- The HTTP schemas are not registered for the Python codegen (`modelOrder`), so
  the AI worker gets no models it does not use.
- The prospectus at-a-glance artifact becomes a Zod schema (`ProspectusArtifact`)
  in contracts, with a generated Pydantic model. The worker validates the
  assembled artifact against it before writing to S3.
- The lenient models in `services/ai/src/tuju_ai/prospectus/analysis_models.py`
  stay hand-written. They parse raw LLM replies (coercion, sorting, truncation),
  which generated models cannot do; they are not part of the wire contract.
- The backend replaces its local `*.types.ts` with the contracts types and types
  its controller returns with them.
- Consequences: contracts becomes a dependency of the frontend bundle (types
  only by default; runtime schemas are used for dev/test validation); contract
  changes now touch backend, frontend, and AI in one place.

Also update `packages/contracts/CONTEXT.md` (Responsibility section) and the
ADR list wherever the repo indexes ADRs (check `README.md` and `docs/`).

## Done when

- ADR-0014 exists and is linked wherever other ADRs are indexed.
- `packages/contracts/CONTEXT.md` mentions HTTP response schemas.
- No code changes.

## Comments

- Done. Files changed:
  - `docs/adr/0014-contracts-owns-http-schemas-and-prospectus-artifact.md` (new)
  - `packages/contracts/CONTEXT.md` (Responsibility, Decisions)
  - ADR index range bumped to 0001-0014: `README.md` (2 lines), `CONTEXT-MAP.md`, `docs/agents/domain.md`
  - This ticket (status, comment)
