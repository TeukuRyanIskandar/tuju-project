# Scaffold: packages/contracts — Zod v4 source + TS/Pydantic codegen + drift gate

Status: done
Done in: e460b7e
Blocked by: 01
Implements: ADR-0007, ADR-0008

## Task

Build the cross-language contract seam — the single schema source both other worlds
consume. This is the highest-leverage package (ADR-0002 top risk = contract drift).

- `packages/contracts` as a TS package authored in **Zod v4**.
- Define the ADR-0007 shapes as Zod schemas: `JobEnvelope<P>`, the TA + FA job
  payloads (two independent job names), the `phase` enums, `job.returnvalue` result
  (claim-check pointer + thin `summary { verdict, headline, asOf }`), and
  `JobFailure { failureClass, retryable, userMessage }`.
- **TS output:** export inferred TS types natively from the Zod schemas.
- **Python output:** `z.toJSONSchema()` (Zod v4 native) → JSON Schema →
  `datamodel-code-generator` → Pydantic v2 models, emitted into a known path the AI
  world imports (`services/ai/.../contracts_generated/`).
- **Commit generated code** (both TS + Python) per ADR-0008.
- A `generate` script that regenerates everything; a `check` script that regenerates
  and fails on `git diff` (the drift gate — wired into CI at ticket 07).
- Golden fixture files (canonical `JobEnvelope`/result payloads) for the ADR-0011
  runtime conformance tests — placed so both TS and Python test suites can load them.

## Done when

`pnpm --filter contracts generate` produces TS types + Pydantic models; the `check`
script passes on clean tree and fails after an intentional edit; golden fixtures exist.

## Notes

Zod v4 native JSON Schema supersedes the deprecated `zod-to-json-schema` lib named in
ADR-0008 — same approach, cleaner tool. Verify `datamodel-code-generator` flags for
Pydantic v2 output at scaffold time.
