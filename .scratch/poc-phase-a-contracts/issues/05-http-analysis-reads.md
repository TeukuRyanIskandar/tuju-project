# Decide: HTTP schemas for latest TA/FA analysis reads

Type: grilling
Status: resolved
Blocked by: 01, 02, 03

## Question

Parent API sketch:

- `GET /stocks/:code/analysis/technical`
- `GET /stocks/:code/analysis/fundamental`

Prospectus public read (`ProspectusAtAGlanceResponse`) returns thin fields +
claim-check + `artifactPath` for Nest-proxied rich JSON. Stock screen also needs
honest **pending / running / ready / facts-only / failed / stale** states.

Pin the **HTTP Zod** for both endpoints:

1. Thin response fields vs always proxy full artifact?
2. How are empty/pending/failed/stale states represented (discriminated union)?
3. Relationship to `SystemSummary` / artifact schemas from tickets 01–03?
4. Shared envelope vs separate technical/fundamental response types?
5. Placement under `http/stocks.ts` vs `http/analysis.ts`?

Fixed inputs: parent tickets 03 + 07; ADR-0014; prospectus HTTP as prior art.

## Notes

- News stays on existing news HTTP — not this ticket.
- No browser enqueue in PoC; these are **read** schemas only.

## Answer

**Prospectus-style thin HTTP + claim-check + Nest-proxied `artifactPath`; strip
`cost` from any proxied rich body; discriminated `status` enum for honest card
states. Place schemas in `http/stocks.ts` beside series.**

### Placement

- [`packages/contracts/src/http/stocks.ts`](../../../packages/contracts/src/http/stocks.ts)
  (same module as stock series / core — one stock-screen HTTP surface).
- Not codegen / not `modelOrder`.

### Paths

- `GET /stocks/:code/analysis/technical` → `StockTechnicalAnalysisResponse`
- `GET /stocks/:code/analysis/fundamental` → `StockFundamentalAnalysisResponse`

Shared base fields; separate exported types so FE imports stay explicit. A shared
internal shape / helper is fine at execution time.

### Pattern (mirror prospectus)

Like `ProspectusAtAGlanceResponse`:

- Thin fields on the HTTP response for first paint / card chrome.
- Claim-check pointer + Nest-proxied path for the rich artifact.
- Browser never talks to S3; Nest fetches, **strips `cost`**, returns rich JSON
  on `artifactPath` (or omits cost keys before proxy). FE must not see
  `ProspectusCostReport` / cost on TA/FA artifacts.

### `status` discriminant (required)

Closed enum on every response:

| Status | Meaning |
| --- | --- |
| `pending` | Never run for this symbol (no JobResult yet) |
| `running` | System job in flight |
| `ready` | Facts + narrative available |
| `facts_only` | Facts present; narrative stripped (grounding fail) or skipped |
| `failed` | Terminal job failure |
| `stale` | Result exists but `asOf` older than last successful EOD ingest |

`status` is the primary UX switch. Do **not** invent fake filler facts.

### Thin fields by status

**Always present:**

- `code`: string
- `jobName`: `'analyze-technical'` | `'analyze-fundamental'` (literal per type)
- `status`: enum above

**When a result exists** (`ready` | `facts_only` | `stale`; optionally
`failed` may carry last error only):

- `headline`: string | null — from `SystemSummary.headline` when present
- `asOf`: IsoDateTime | null — from `SystemSummary.asOf` / artifact
- `artifact`: `{ bucket, key }` claim-check (sha optional on HTTP thin layer;
  full `ArtifactPointer` remains on JobBus `JobResult`)
- `artifactPath`: string — Nest proxy URL for cost-stripped rich artifact

**When no artifact yet** (`pending` | `running`):

- `headline` / `asOf` / `artifact` / `artifactPath` are **null** (required-nullable
  keys — never omit)

**`failed`:**

- `errorMessage`: string (safe user-facing; never raw stack)
- artifact fields null unless a prior successful artifact is intentionally kept
  (PoC default: null on terminal fail)

**`stale`:**

- Same thin + artifact fields as `ready`, plus status `stale` so FE shows the
  “not latest close” chip without hiding data.

Optional thin mirrors (execution may add if FE needs zero round-trip):

- TA: compact event-fired counts or timeframe echo (`1D`) — **not required** in
  handoff; card can load rich artifact via `artifactPath`.
- FA: metric N/A counts — same; prefer proxy for full metrics table.

Pin for handoff: **thin = status + SystemSummary fields + claim-check +
artifactPath**; rich facts/events/metrics/narrative live behind `artifactPath`
(cost stripped).

### Relationship to tickets 01–03

- Rich body schemas: `TechnicalAnalysisArtifact` / `FundamentalAnalysisArtifact`.
- Thin headline/asOf policy: ticket 03 `SystemSummary`.
- Cost strip: tickets 01–02.

### News

Out of scope — existing news HTTP / parent ticket 07.

### Unblocks

- Ticket 06 handoff can list both analysis endpoints with status enum + cost
  strip as normative
