# Decide: ingest + ops cadence for PoC

Type: grilling
Status: resolved
Blocked by: 02

## Question

Parent cadence: nightly after successful EOD + snapshot materialisation, plus
ops/CLI recompute. Free-tier already has `@nestjs/schedule` nightly ingest in
the dedicated ingestion worker (ADR-0012) and one-shot `worker-main.js`
commands (`seed-prospectus`, `enqueue-prospectus`).

Pin **how PoC ingest runs**:

1. Wire yfinance into the existing nightly cron, or PoC-only CLI commands for
   the checkpoint (cron later)?
2. Command names / args (e.g. `ingest-klci`, `seed-klci`)?
3. Order of steps: seed reference → pull bars → pull fundamentals → materialise
   snapshots/indicators → (enqueue is ticket 05)?
4. Idempotency: reuse free-tier upsert-on-natural-key posture?
5. What must an operator run before a live panel demo (minimum happy path)?

Fixed inputs: parent tickets 01–02; ADR-0012 worker entrypoint.

## Notes

- System enqueue of TA/FA is ticket 05 (may be same ops session, separate
  decision).
- Intraday / movers boards stay out of PoC demo script.

## Answer

**CLI-first (`seed-klci` + `ingest-klci`) with nightly cron also on the
yfinance path when that DI is bound; upsert-on-natural-key; enqueue separate
(ticket 05).**

### 1. Cadence

- **CLI is the demo checklist** (explicit, re-runnable before a panel).
- When `DATA_SOURCE` (or pinned env name from ticket 02) selects yfinance,
  the **existing nightly EOD ingest cron** in the ingestion worker should
  exercise the same PoC pull/materialise path so overnight stays fresh.
- Intraday / movers crons stay irrelevant to the PoC demo script.

### 2. Commands (`worker-main`)

| Command | Role |
| --- | --- |
| `seed-klci` | Upsert Sector / Company / Instrument (and aliases) from `klci30-universe.ts` |
| `ingest-klci` | Pull bars + fundamentals via yfinance adapters; materialise snapshots / indicators for the 30 |
| _(ticket 05)_ | System enqueue TA/FA (separate command; not folded into ingest) |

Mirror the prospectus ops style (`seed-prospectus` / `enqueue-prospectus`).

### 3. Step order

1. `seed-klci` (reference rows; safe to re-run)
2. `ingest-klci`: bars → fundamentals → materialise price/fundamentals
   snapshots + ADR-0012 indicators for the universe
3. Ticket 05 enqueue after successful materialisation (same ops session or
   nightly follow-on — pinned there)

`ingest-klci` may no-op-fail loudly if seed missing for a code (build choice);
happy path is seed then ingest.

### 4. Idempotency

- **Upsert on natural keys** (same posture as free-tier ingest). Re-running
  before a panel is safe and expected.
- Still open an `IngestionRun` for lineage/provenance; rows update in place.

### 5. Minimum panel prep (operator)

Assuming Redis/Postgres/S3/API/worker already up and `DATA_SOURCE=yfinance`:

1. `seed-klci` (once per membership change / fresh DB)
2. `ingest-klci` (if nightly has not already succeeded today)
3. Ticket 05 enqueue command (if analyses stale / missing)
4. Wait for worker jobs → open `/stocks/1155`

### Unblocks

- Ticket 05 command session assumptions; handoff ops section.
