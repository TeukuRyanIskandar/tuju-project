# Decide: analysis result persistence + status

Type: grilling
Status: resolved
Blocked by: (none)

## Question

Contracts pin thin HTTP analysis reads with status
`pending | running | ready | facts_only | failed | stale`, plus claim-check +
`artifactPath`. Prospectus already persists a thin
`prospectus_analyses` row (unique per listing) when a system job lands.

Pin **how Nest stores latest TA/FA for an instrument**:

1. One table vs two (`technical_analyses` / `fundamental_analyses`)? Unique key
   (instrument id? stockCode + jobName)?
2. Which columns mirror prospectus (headline, asOf, S3 pointer, …) vs job
   progress fields?
3. Who writes the row — job completion hook in Nest (BullMQ events) vs polling?
4. How is each `status` derived (no row → pending; active job → running;
   grounding strip → facts_only; asOf vs latest close → stale)?
5. Migrations + relationship to free-tier Instrument entity?

Fixed inputs: contracts ticket 05 / `StockTechnicalAnalysisResponse` shape;
ADR-0004 (Nest sole writer); prospectus store as prior art.

## Notes

- Worker never writes Postgres.
- `facts_only` is a product state when narrative is stripped after grounding
  fail — BE must be able to surface it once the worker signals it (exact signal
  may be thin summary convention or artifact presence; pin here or defer a
  narrow note to worker map).

## Answer

**Two tables (`technical_analyses` / `fundamental_analyses`); Nest JobBus
completion hook upserts; always upsert status rows including pending/failed
(unlike prospectus).**

### 1. Tables + unique key

- **Two tables**, one per job family — mirrors the two HTTP envelopes and
  keeps TA/FA re-runs from stomping each other.
- Unique key: **`instrument_id`** (FK → `Instrument`, CASCADE). One latest
  row per instrument per table.
- Lookups for HTTP still go Bursa `stockCode` → Instrument → analysis row
  (same pattern as stock core). Do **not** unique on `stockCode` string —
  Instrument is the canonical FK.

### 2. Columns (claim-check + progress)

Mirror prospectus claim-check, then add PoC status fields contracts need:

| Column | Role |
| --- | --- |
| `instrument_id` | FK unique |
| `status` | enum matching `StockAnalysisStatus` |
| `headline` | nullable thin summary (null while pending/running) |
| `as_of` | nullable timestamptz |
| `artifact_bucket` / `artifact_key` | nullable until ready/facts_only |
| `correlation_id` / `job_id` | current attempt (ADR-0007) |
| `error_message` | nullable; set on `failed` |
| `created_at` / `updated_at` | audit; bump on every upsert |

No separate "progress" table — status lives on the same row.

### 3. Writer

- **Nest JobBus completion / result hook** (same pattern as
  `MarketBriefStore` / `ProspectusAnalysisStore` / announcement summary —
  QueueEvents → sole Postgres writer).
- Worker never writes these tables (ADR-0004).
- **Enqueue path (ticket 05)** also upserts the row to `pending` (then
  `running` when the job is observed active) so HTTP never relies on
  "no row = pending".

### 4. Status derivation

| Status | When |
| --- | --- |
| `pending` | Enqueue upserted; not yet actively processing |
| `running` | Job observed active / started (hook or enqueue transition) |
| `ready` | Successful result with full narrative artifact |
| `facts_only` | Worker signals grounding strip / facts-only thin summary (exact payload field → worker map; BE stores the status the hook receives) |
| `failed` | Terminal job failure — **row kept** with `error_message` (unlike prospectus) |
| `stale` | Prior `ready`/`facts_only` whose `as_of` is behind latest EOD close / ingest watermark for that instrument (read-time or post-ingest refresh — build may compute on read; pin "stale means asOf < latest close day" in handoff) |

**No row** is not a PoC HTTP state for the 30 once enqueue has run; ticket 05
creates the row. Before any enqueue, reads may still map missing row →
`pending` for UX (ticket 06).

### 5. Migrations + Instrument

- New TypeORM migrations creating both tables + FKs to `instruments`.
- Free-tier Instrument entity unchanged; PoC analysis rows attach to the same
  Instrument rows created by `seed-klci`.
- Synthetic free-tier names outside the 30 are out of PoC reads (ticket 01
  hard-gate) — no analysis rows required for them.

### Unblocks

- Ticket 05 (pending row on enqueue; dedup vs existing row status).
- Ticket 06 (thin read mapping + stale/pending without row).
- Handoff persistence section.
