# PoC / Phase A Map — Auto TA + FA (Product A)

Label: `wayfinder:map`

## Destination

One **overarching product/demo spec** for the venture-builder PoC checkpoint:
Pitch Feedback scope (FBM KLCI 30, one stock screen, descriptive auto TA + FA),
**system-precomputed** jobs, **real yfinance** data for a private demo, OpenRouter
narration. FE / BE / worker get their own specs later; this map finds the product
spec only.

> **DESTINATION REACHED (2026-10-08).** Tickets 01–07 resolved; overarching handoff
> at [`spec.md`](spec.md).

## Notes

- **Planning only.** Resolve decisions; the overarching spec is written at the end
  (`to-spec`). Building is a separate execution effort (later split into FE/BE/worker).
- **North star:** [Pitch Feedback — Shared Understanding](file:///Users/ryan.iskandar/Documents/Obsidian/ryan_mac/Pitch%20Feedback%20—%20Shared%20Understanding.md)
  (2026-10-08). User locks: Q1 = Pitch Feedback literally; Q2 = system-precompute;
  real data if possible; one overarching spec.
- **Fixed inputs (do not re-decide):** ADR-0001–0014. Especially ADR-0004 (NestJS
  sole Postgres writer, Python stateless, Redis cache classes), ADR-0005 (free tier
  enqueues no user-triggered jobs; system caller bypasses tier), ADR-0007
  (`analyze-technical` / `analyze-fundamental` already exist), ADR-0012 (TS
  indicators in NestJS ingestion worker), ADR-0013 (system-triggered jobs).
- **Demo audience = private** (venture-builder panel / partners). yfinance is
  internal/demo only — **cannot** go public (Yahoo ToS).
- **Demo-script supersession:** this PoC **replaces** the free-tier synthetic +
  prospectus path as the pitch demo script. Free-tier code/specs remain in the repo
  but are not what we walk the panel through.
- **Skills:** `grilling` for decide tickets; light `research` only if yfinance news
  coverage blocks; `to-spec` for the final overarching spec.

## Decisions so far

- [Decide: PoC data posture — yfinance KLCI 30](issues/01-poc-data-posture.md):
  **yfinance `.KL` behind the existing adapter seam for KLCI 30 only.** Cache +
  throttle; provenance `real` with visible “private demo / non-redistributable”
  label. Synthetic free-tier universe stays in DB but is **out of the demo script**.
  Public launch still requires licensed feed (EODHD / Bursa) — same licence boundary
  as free-tier decision B, tightened: yfinance must be purged/swapped before any
  public exposure. Fundamentals come from yfinance (not PDF); A1 co-generation does
  **not** apply on this path because prices and fundamentals are both real.
- [Decide: system-precompute trigger for TA/FA](issues/02-system-precompute-trigger.md):
  **Reuse `analyze-technical` + `analyze-fundamental` with `trigger: 'system'`.**
  Nightly (post-ingest) + ops/CLI re-run for the 30 names. No user `@RequiresJob`
  path in PoC. ADR-0005 unchanged. Paid click-to-run stays future work.
- [Decide: descriptive artifact contract](issues/03-descriptive-artifact-contract.md):
  **Verdict-less thin summary (`SystemSummary`: headline + asOf).** Rich S3 JSON =
  structured **facts** (code) + **narrative** (LLM). Existing `TechnicalVerdict` /
  `FundamentalVerdict` stay in the contract for a future paid path but are **not
  emitted** by PoC jobs. No buy/sell language in prompts or UI. Phase label
  `synthesizing-verdict` kept on the wire (additive rename deferred to worker spec);
  semantically it means “drafting narrative”.
- [Decide: TA fact engine defaults](issues/04-ta-fact-defaults.md):
  **Defaults:** SMA-20/50/200 crosses, RSI-14 bands, MACD line/signal cross, 52-week
  high/low proximity + “broke prior swing high” from recent highs. Output =
  structured **events** with computed numbers + dates. Indicators from stored EOD
  bars (TS `trading-signals` path / same definitions as ADR-0012). User-defined
  indicators deferred.
- [Decide: FA fact engine + news](issues/05-fa-fact-and-news.md):
  **Defaults from Pitch Feedback:** trailing P/E, dividend yield, ROE, revenue &
  profit growth QoQ/YoY, debt/equity, operating cash flow — from yfinance info /
  financials. Nulls are first-class (e.g. bank D/E). News = ticker-linked
  headline+link on the same screen; prefer existing RSS/tagging path when a
  yfinance `.news` row is thin or missing (coverage unverified — degrade
  gracefully).
- [Decide: OpenRouter narration rules](issues/06-openrouter-narration.md):
  **Reuse OpenRouter client; default model `google/gemini-2.5-flash` (override via
  `LLM_MODEL`; free-route models allowed).** BM plain-language primary, English
  secondary for the PoC cards. **Grounding:** narrative may only use numbers/
  events present in the fact payload; fail closed (no narrative card) if facts
  empty. Cost bound by 30×2 nightly jobs; soft ceiling per job (worker spec pins $).
- [Decide: one-screen product surface](issues/07-one-screen-surface.md):
  **Route `/stocks/:code` for KLCI 30:** header (identity + last close) + OHLC chart
  series + TA card (facts + narrative) + FA card (facts + narrative) + news list.
  Anonymous read. Chart series graduated from free-tier fog **for PoC only**
  (EOD daily, ~2y). Search/picker restricted to the 30. Empty/stale/missing
  artifact states defined. Pixel DESIGN.md deferred to FE spec.

## Not yet specified (deferred to child specs)

- **FE spec:** DESIGN.md, chart library, card layout, BM copy polish, loading UX.
- **BE spec:** yfinance adapter impl, KLCI 30 seed list maintenance, ingest cron,
  system enqueue cron/ops command, read endpoints + migrations, cache keys.
- **Worker spec:** LangGraph for TA/FA, prompt text, goldens for grounding, exact
  cost ceiling, phase-label rename if desired.
- **Paid user-triggered enqueue** and billing.
- **Survey / TTW homework / LMC cost-structure update** — product homework, not
  blocking this technical destination.

## Out of scope

- IPO / prospectus analysis in the PoC demo script (built code may stay; not shown).
- FCPO, alerts, accounts / watchlist sign-up.
- Public launch licensing contracts (architecture vendor task).
- Replacing or deleting the free-tier synthetic pipeline (supersession is demo-
  script only).
- Building the product (execution after this map).
