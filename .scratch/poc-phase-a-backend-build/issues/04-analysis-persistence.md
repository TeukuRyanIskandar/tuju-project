# Build ticket: analysis tables + JobBus hooks

Type: task
Status: resolved
Blocked by: (none)

> Execution of handoff § analysis result persistence (planning ticket 04).
> Wave 2. Independent of adapters; prior art =
> `ProspectusAnalysisStore` / `MarketBriefStore`.

## Scope (this ticket only)

- Migrations + entities: **`technical_analyses`** and
  **`fundamental_analyses`**.
- Unique key: `instrument_id` FK → `Instrument` (CASCADE).
- Columns: `status` (`StockAnalysisStatus`), nullable `headline` / `as_of` /
  artifact bucket+key / `error_message`, `correlation_id`, `job_id`,
  `created_at` / `updated_at`.
- Stores with upsert API used by enqueue (ticket 05) and JobBus hooks.
- Nest JobBus completion / failure hooks (ADR-0004 sole writer):
  - success + `SystemSummary` → `ready` (pointer + headline + asOf)
  - `onFailure` → `failed` + `error_message`
  - **Do not write `facts_only` yet** (map pin — worker map owns signal)
- Do **not** reuse `analysis_results` (verdict-bearing scaffold).

## Out of scope

- Enqueue command / pending upsert from CLI (ticket 05 owns calling store).
- HTTP mapping / stale promotion (ticket 06).
- Worker artifact assembly.

## Testing seam

- Unit: upsert pending → ready; failure path; unique per instrument.
- Hook tests with fixture `JobResult` system summaries from contracts.

## Acceptance

- Migrations apply; stores + hooks covered by tests; `facts_only` never set
  by this ticket’s code paths.

## Answer

- Migration `1728300000000-StockAnalyses`: `technical_analyses` +
  `fundamental_analyses` (shared `stock_analysis_status` enum), unique
  `instrument_id` → `instruments` CASCADE.
- Entities + `TechnicalAnalysisStore` / `FundamentalAnalysisStore` with public
  `upsert` (for ticket 05 enqueue → `pending`) and JobBus hooks: colon-form
  `JobResult` `technical:`/`fundamental:` + `SystemSummary` → `ready`; BullMQ
  `ta-`/`fa-` `onFailure` → `failed` + `error_message`. Never writes
  `facts_only`. Wired in `AnalysisModule` (exported); registered in
  data-source / DataModule. Does not touch `analysis_results`.
