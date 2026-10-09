# Task: write PoC Phase A contracts handoff spec

Type: task
Status: resolved
Blocked by: 01, 02, 03, 04, 05

## Question

Synthesise tickets 01–05 into a single contracts handoff at
[`../spec.md`](../spec.md). BE / worker / FE implementation specs are **out of
scope** — only name them as consumers of this seam.

## Notes

- Status on the handoff: `ready-for-agent` when written.
- Mark destination reached on `map.md` when done.
- Do not implement Zod in this ticket; the spec is the destination.

## Answer

Wrote [`.scratch/poc-phase-a-contracts/spec.md`](../spec.md) with status
`ready-for-agent`. Destination marked reached on [`map.md`](../map.md).

Synthesised:

- TA/FA registered artifact roots + shared envelopes (01–02)
- JobResult `SystemSummary` docs/fixture policy (03)
- Stock series HTTP `1d`/`2y` OHLC+volume string NUMERIC (04)
- Analysis reads status enum + prospectus-style thin + cost-stripped proxy (05)

No Zod implementation in this ticket.
