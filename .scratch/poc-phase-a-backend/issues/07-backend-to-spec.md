# Task: write PoC Phase A backend handoff spec

Type: task
Status: resolved
Blocked by: 01, 02, 03, 04, 05, 06

## Question

Synthesise tickets 01–06 into a single backend handoff at
[`../spec.md`](../spec.md). Worker / FE implementation specs are **out of
scope** — only name them as consumers / follow-ons. Optionally sketch the
first execution wave of build tickets (do not implement Nest here).

## Notes

- Status on the handoff: `ready-for-agent` when written.
- Mark destination reached on `map.md` when done.
- Do not implement adapters, migrations, or routes in this ticket.

## Answer

Wrote [`.scratch/poc-phase-a-backend/spec.md`](../spec.md) with status
`ready-for-agent`. Destination marked reached on [`map.md`](../map.md).

Synthesised:

- KLCI 30 seed + hard-gate + 01a membership paste (01, 01a)
- yfinance dual adapters, env DI, cache/throttle, RSS news (02)
- `seed-klci` / `ingest-klci` CLI + nightly when bound (03)
- Two analysis tables, JobBus hook, always-upsert status (04)
- `enqueue-klci` skip/force + pending upsert + nightly follow-on (05)
- stocks.controller series/analysis + cost-stripped artifact paths (06)

No Nest implementation in this ticket.
