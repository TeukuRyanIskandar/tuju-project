# PoC / Phase A Worker Map — facts → narration → claim-checked artifacts

Label: `wayfinder:map`

## Destination

One **worker handoff spec** for PoC Phase A that `services/ai` can execute
without re-opening product, contracts, or BE locks: fact assembly for
`analyze-technical` / `analyze-fundamental`, the real TA/FA handlers that
replace the ADR-0003 stub, the OpenRouter narrative prompt, the grounding
post-check, the `facts_only` wire signal (which the BE hook consumes), and
the per-job cost ceiling.

BE consumes this via small named follow-ons (worker-facing reference read,
TA event detection, OCF ingest, hook `facts_only` mapping); FE is untouched.

## Notes

- **Planning only.** Resolve decisions; `to-spec` writes the handoff. No
  Python code in this map (execution is a later worker build pass).
- **Parent:** [PoC / Phase A overarching](../poc-phase-a/spec.md) —
  destination reached. Product locks (descriptive policy, fact defaults,
  grounding rules, BM-dropped-for-PoC) are **fixed inputs**.
- **Contracts:** [PoC Phase A contracts](../poc-phase-a-contracts/spec.md) —
  `TechnicalAnalysisArtifact` / `FundamentalAnalysisArtifact` /
  `SystemSummary` Zod + generated Pydantic already landed. Do **not**
  re-open shapes.
- **BE:** [backend handoff](../poc-phase-a-backend/spec.md) + [build map]
  (../poc-phase-a-backend-build/map.md) — envelope payloads locked to
  `{ symbol: stockCode, timeframe: '1D' }` / `{ symbol, period: 'quarterly' }`;
  BE enqueues + upserts `pending`; BE hooks write `ready` / `failed` only.
- **Locked-shape constraints (do not re-open; tickets work within them):**
  - `JobResult.pointer` is **required** — every completed run (including
    facts-only) must claim-check an artifact.
  - `AnalysisNarrative.text` is `min(1)` — an artifact cannot carry an empty
    narrative; a stripped run still needs non-empty `narrative` or no
    artifact at all.
  - `SystemSummary` = `{ headline, asOf }` only — no status side-channel.
  - Phase enums keep `synthesizing-verdict` (semantically "drafting
    narrative"); `drafting-narrative` exists only on the market-brief job.
  - BE hooks parse `JobResult.jobId` colon forms **`technical:<stockCode>:…`**
    / **`fundamental:<stockCode>:…`** (`stock-analysis.upsert.ts`); the current
    stub mints `ta:<symbol>:…` and is **not** parsed — the PoC worker must
    mint the `technical:` / `fundamental:` prefixes.
  - `AnalysisProvenance` is fixed `{ source: 'real', adapter: 'yfinance',
    model, generatedAt }`.
- **Data the worker can already reach (BE state):** indicator **values**
  (SMA-20/50/200, RSI-14, MACD 12/26/9, 52-w high/low, latest close)
  materialised nightly for the 30; yfinance quarters (revenue, netProfit,
  eps, equity, nta, intangibles, totalBorrowings) + sharesOutstanding + TTM
  dividends; house-derived ratios (P/E, DY, ROE, D/E) per the CONTEXT.md
  definitions. **No event detection exists anywhere yet** (the 7
  `TechnicalEventId`s are unimplemented) and **no OCF is ingested**
  (quoteSummary fetches only `defaultKeyStatistics`).
- **Context:** `services/ai/CONTEXT.md`. Prior art: `BackendClient` +
  anonymous NestJS reads (the IPO-reference pattern), `llm/` seam (OpenRouter,
  `CostTracker` with the ~$2 prospectus ceiling), `FakeLLMClient`, strict
  pre-write Pydantic validation, `TerminalJobError` vs transient failure
  classes, `_heartbeat`.
- **Skills:** `grilling` for decide tickets; `to-spec` for the final handoff.

## Decisions so far

- [Decide: fact assembly + TA event ownership](issues/01-fact-assembly-and-events.md):
  **`BackendClient` reference read `GET /stocks/:code/analysis/reference`
  (anonymous, KLCI-30-gated, backend-local type — not in contracts); TA
  events computed TS-side on read from stored bars (recompute-on-demand
  precedent); FA = materialised house ratios + quarterly growths + additive
  yfinance `financialData` OCF fetch (BE follow-on); per-metric `asOf`
  follows its source day.**

- [Decide: TA/FA handler shape + failure classes + progress](issues/02-handler-shape-failures.md):
  **Flat functions, drop LangGraph for TA/FA (no branching/checkpoints
  needed for linear pipeline). Phases: TA `fetching-market-data` →
  `computing-indicators` → `synthesizing-verdict`; FA `fetching-financials` →
  `computing-metrics` → `synthesizing-verdict`. Failure classes: terminal
  (404, empty facts, bad envelope, LLM permanent, cost ceiling, grounding
  violation) vs transient (5xx, timeout, rate-limit). JobId colon forms
  `technical:symbol:1D:bucket` / `fundamental:symbol:quarterly:bucket`.
  Artifact layout `analysis/{ta|fa}/symbol/bucket.json`.**

- [Decide: OpenRouter narrative prompt + policy](issues/03-narrative-prompt.md):
  **One corrective LLM retry on malformed output (echo bad reply + append
  corrective instruction). Word count soft (prompt only, ~80–150). Provenance
  model = effective LLM id after env resolution. Prompts include system
  framing (facts only, no advice), user message with fact JSON inline, event
  labels as anchors, audience = private demo panel. Null metrics stated as
  absence (no guessing).**

- [Decide: grounding post-check + facts-only artifact](issues/04-grounding-postcheck.md):
  **Raw string containment for number check (every numeral in narrative must
  appear verbatim in facts or event values). Ban-word list (buy/sell/hold,
  target, undervalued, etc.). Violation → strip narrative to deterministic
  placeholder `"Narrative withheld: failed the grounding check."` + generate
  headline prefix `"facts-only: …"`. Job completes with pointer; BE hook
  sees sentinel. Check lives in handler before Pydantic pre-write validation.**

- [Decide: `facts_only` wire signal + headline policy](issues/05-facts-only-signal.md):
  **Signal carrier: `SystemSummary.headline` prefix `"facts-only: "`. Normal
  ready headline = deterministic code (top fired event label, or key metric
  summary). Empty-facts path = `TerminalJobError` (fail hard; no facts-only
  signal). BE hook pattern-matches headline prefix; FE already distinguishes
  by status.**

- [Decide: per-job cost ceiling + nightly budget](issues/06-cost-ceiling.md):
  **Per-job ceiling $0.10 USD (~60× expected single-call cost; safe for one
  corrective retry). Nightly worst-case $6 (60 jobs × $0.10). Per-job
  `CostTracker` only (PoC). Populate `ProspectusCostReport` from
  `CostTracker.report()`. Ceiling exceeded → facts-only strip (not terminal;
  facts good, only narration at stake).**

## Not yet specified

All decisions 01–06 are resolved. **Destination reached:** see [spec.md](spec.md).

Map is complete. Implementation tickets ready: [BUILD-PLAN.md](issues/BUILD-PLAN.md).

### Build tickets (ready-for-agent)

1. [**08-be-reference-endpoint.md**](issues/08-be-reference-endpoint.md) — Backend `GET /stocks/:code/analysis/reference` + TA event detection
2. [**09-be-facts-only-hook.md**](issues/09-be-facts-only-hook.md) — Wire `facts-only:` headline → `FactsOnly` status
3. [**10-worker-ta-fa-handlers.md**](issues/10-worker-ta-fa-handlers.md) — Python TA/FA handlers, grounding check, LLM narration, cost tracking

## Out of scope

- FE DESIGN.md, chart library, card layout (→ FE map).
- Re-shaping `@tuju/contracts` (artifacts, `JobResult`, phases, envelopes).
- Re-opening the BE handoff (payloads, skip rules, HTTP routes, migrations).
- Bahasa Malaysia narrative for PoC (dropped at the contracts map;
  `language: 'en'`).
- Paid user-triggered enqueue, verdicts, watchlist, alerts, accounts.
- Public-launch licensing / yfinance purge.
- Building Python worker code (execution after this map).
