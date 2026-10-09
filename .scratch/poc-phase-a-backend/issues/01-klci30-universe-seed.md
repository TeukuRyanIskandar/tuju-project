# Decide: KLCI 30 universe seed

Type: grilling
Status: resolved
Blocked by: (none)

## Question

Parent locked **analysed PoC universe = current FBM KLCI 30 ordinary shares** as
a curated seed (stock codes + Yahoo `.KL` suffixes), refreshed manually when
index membership changes. Free-tier already has a smaller
[`REFERENCE_UNIVERSE`](../../../apps/backend/src/ingestion/reference-universe.ts)
for synthetic demo names.

Pin the **BE seed**:

1. File location + format (TS const vs JSON vs both)? Extend
   `reference-universe.ts` or a separate PoC module?
2. Required fields per row (Bursa `stockCode`, Yahoo symbol, names, sector,
   board, aliases)?
3. How is membership updated when KLCI reconstitutes — PR-only? ops command?
4. Does PoC search / stock core **reject** non-30 codes, or allow other DB
   instruments but leave them out of the demo script / enqueue fan-out?
5. Who owns the first concrete list of 30 (grill answer vs research ticket)?

Fixed inputs: parent ticket 01; contracts series/analysis keyed by Bursa
`stockCode`; demo script uses e.g. `/stocks/1155`.

## Notes

- Parent: “PoC does not scrape index constituents live.”
- Reference Company/Instrument rows are `real` provenance and survive
  decision-B purge; prices/fundamentals on the PoC path will be yfinance
  `real` + private-demo label (ticket 02).
- Overlap with free-tier seed (MAYBANK, CIMB, …) is expected — one Instrument
  row per code.

## Answer

**Separate PoC TS module; hard-gate PoC reads to the 30; concrete membership
via research ticket then paste into the module.**

### 1. Location + format

- New module, e.g. `apps/backend/src/ingestion/klci30-universe.ts` (name may
  drift slightly in build; keep it next to `reference-universe.ts`).
- Exported typed const array (TS only — no JSON twin for PoC).
- Do **not** extend `REFERENCE_UNIVERSE` (that stays the free-tier synthetic
  reference seed).

### 2. Row fields

Mirror `ReferenceCompany` plus the Yahoo binding:

- `stockCode` — Bursa 4-digit code (natural key; same as contracts HTTP)
- `yahooSymbol` — e.g. `1155.KL`
- `shortName`, `fullName`
- `board` — `ListingBoard` (KLCI ordinary shares are Main)
- `sectorName`
- `aliases` — search helpers

### 3. Membership refresh

- **PR-only** edit of the TS module when FTSE/Bursa reconstitutes KLCI.
- No live constituent scrape; no dedicated ops “reconstitute” command for PoC.
- Ingest / enqueue **read** this const — they do not discover membership.

### 4. Hard-gate PoC reads

- PoC path HTTP that serves the demo script (**stock core / series / analysis
  thin reads / artifact proxy** for this surface) **rejects codes outside the
  KLCI 30 seed** (404 or equivalent — pin exact status in ticket 06 / build).
- Free-tier synthetic instruments may remain in DB and on non-PoC routes; they
  are out of the PoC demo script and out of system TA/FA fan-out.
- System enqueue fan-out = exactly the seed list (ticket 05).

### 5. Concrete 30 list

- Not pinned in this grill. Follow-up
  [01a — KLCI 30 membership research](01a-klci30-membership-research.md)
  produces the paste-ready table; handoff (`07`) embeds it (or points at the
  module to create in build).

### Unblocks

- Ticket 02 (adapter binding) and 05 (fan-out over seed).
- Research 01a for the paste list.
