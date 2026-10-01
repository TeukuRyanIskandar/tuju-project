# Build ticket: Screener fields endpoint (`GET /screener/fields`)

Type: task
Status: ready-for-agent
Blocked by: 01

> Wave 2 of the spec-03 execution effort breaking down
> [spec 03 — screener](../../free-tier-specs/03-screener.md).

## What to build

The anonymous `GET /screener/fields` endpoint: advertises the available
screener filters and their enum domains so the FE builds the form without
hardcoding — the filter vocabulary from ticket 01's seam (names, kinds: enum /
numeric band / boolean, which take min/max), the board domain (`MAIN`/`ACE`
from `ListingBoard`), and the sector domain (id + name from the `Sector`
reference table, name-ordered). Class-2 cached under `cache:screener:`
(invalidated by the existing nightly sweep). Deliberately no `@RequiresJob`
(anonymous, ADR-0005).

## Acceptance criteria

- [ ] The filter set advertised matches the `GET /screener` params exactly
      (same names/kinds — a drift test guards it against ticket 01's parse
      layer).
- [ ] Sector domain read from Postgres (`Sector` reference entity), board
      domain from the enum; both class-2 cached.
- [ ] Integration tests through the composed module (testcontainers), prior
      art `search.int.spec.ts`; unit tests for any pure mapping (no containers).

## Out of scope

- `GET /screener` itself (ticket 02 — parallel agent).
- `app.module.ts` wiring of ticket 02's module (orchestrator, post-wave).
