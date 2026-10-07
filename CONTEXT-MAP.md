# Context Map

`tuju-project` is a multi-context monorepo (ADR-0002). Contexts do not map to
`src/<context>/` folders; they map to **workspace members** across the two worlds
(TS world under `apps/*` + `packages/*`; Python world under `services/*`).

The two worlds communicate **only** through the Redis + BullMQ JobBus (ADR-0001)
and the shared contract seam (`packages/contracts`, ADR-0007) — never via
cross-language code imports.

## Contexts

| Context             | Path                  | World  | `CONTEXT.md`                        |
| ------------------- | --------------------- | ------ | ----------------------------------- |
| Contract seam       | `packages/contracts`  | TS     | `packages/contracts/CONTEXT.md`     |
| Backend             | `apps/backend`        | TS     | `apps/backend/CONTEXT.md`           |
| Frontend            | `apps/frontend`       | TS     | `apps/frontend/CONTEXT.md`          |
| AI worker           | `services/ai`         | Python | `services/ai/CONTEXT.md`            |

Read the `CONTEXT.md` for whichever context(s) your topic touches. For a change
that crosses the seam (e.g. a new job type), read `packages/contracts/CONTEXT.md`
first, then the producer (`apps/backend`) and consumer (`services/ai`) contexts.

## Decisions

- **System-wide decisions** live in `docs/adr/` at the repo root (ADR-0001–0013).
- **Context-specific decisions**, if any emerge later, live in
  `<context-path>/docs/adr/`. None exist yet; the root ADR set still covers every
  context.

See `docs/agents/domain.md` for how the engineering skills consume these files.
