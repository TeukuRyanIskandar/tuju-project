# Spec: PoC / Phase A — Auto TA + FA (overarching)

Status: ready-for-agent

> Handoff produced by `to-spec` from the [PoC / Phase A wayfinder map](map.md).
> Source decisions: tickets [01](issues/01-poc-data-posture.md)–[07](issues/07-one-screen-surface.md).
>
> **Scope of this document:** product/demo destination for the venture-builder
> PoC checkpoint. It is **not** an FE, BE, or worker build ticket list — those
> are separate child specs after this one.
>
> **Fixed inputs:** ADR-0001–0014 (especially 0004, 0005, 0007, 0012, 0013).
> **North star:** Pitch Feedback — Shared Understanding (2026-10-08).

## Problem Statement

The panel asked whether we can do what we pitch: **automated technical +
fundamental analysis on a Bursa stock**, with a credible accuracy story, on a
demoable surface. Free-tier dashboard plumbing exists, but Phase A auto TA/FA
does not, LLM narration for TA/FA is unset, and the pitch demo script must not
depend on synthetic prices or IPO prospectus wow.

## Solution

A **private PoC** over **FBM KLCI 30** real market data (yfinance), with
**system-precomputed** `analyze-technical` and `analyze-fundamental` jobs
(OpenRouter narration over **code-computed facts**), read on **one anonymous
stock screen**: chart + TA card + FA card + news. No user-enqueue, no buy/sell
signals, no IPO in the demo script.

## Demo script (success criteria)

1. Operator has run ingest + system precompute for KLCI 30 (nightly or CLI).
2. Presenter opens `/stocks/1155` (or another KLCI 30 name).
3. Screen shows real(ish) EOD chart, a descriptive BM TA card, a descriptive BM
   FA card, and news (or an honest empty news state).
4. Presenter states: **numbers come from code; the paragraph is LLM wording
   checked against those numbers** — answering the accuracy question.
5. Presenter does **not** walk prospectus, synthetic “illustrative” screener, or
   account signup.

## User Stories

1. As a panel member, I want to open one KLCI stock and see TA + FA + news
   together, so that the “one-stop + automation” pitch is tangible.
2. As a panel member, I want summaries to describe what happened in the data
   (crosses, RSI level, P/E, growth), so that we are not shown buy/sell advice.
3. As a panel member, I want confidence that indicator/metric numbers are
   reproducible from market data, so that “how accurate?” has a crisp answer.
4. As the operator, I want TA/FA precomputed by the system for only 30 names, so
   cost and licence exposure stay bounded for a private demo.
5. As the operator, I want yfinance clearly labelled non-redistributable, so we
   do not imply a public-launch data licence.
6. As a builder, I want one overarching spec first, so FE/BE/worker can split
   without re-debating product scope.

## Implementation Decisions

### Universe and data posture

- **Universe:** curated FBM KLCI 30 ordinary shares (seed list of Bursa codes +
  Yahoo `.KL` suffixes). Manual refresh when index membership changes.
- **Prices + fundamental inputs:** yfinance, scheduled, **cached and throttled**.
- **Indicators:** derived in-house from stored EOD bars (ADR-0012 family).
- **Provenance:** `real` + UI chip **“private demo — non-redistributable”**.
- **Demo-script supersession:** free-tier synthetic + prospectus remain in the
  repo but are **out of this demo script**.
- **Public launch:** purge/stop yfinance; swap to licensed EODHD/Bursa before any
  public exposure (architecture vendor task). Yahoo ToS forbids commercial use
  of the API without permission.

### Job trigger (system-precompute)

- Jobs: existing **`analyze-technical`** and **`analyze-fundamental`**.
- Envelope: **`trigger: 'system'`** (ADR-0005 trusted caller; no tier check).
- Defaults: timeframe `1D`, period `quarterly`.
- Cadence: nightly after successful EOD + snapshot materialisation; plus ops/CLI
  recompute one|all for dry-runs.
- Fan-out: 30 × 2 jobs; per-symbol failure isolation; BullMQ dedup by symbol +
  job + day.
- **No browser enqueue in PoC.** Paid click-to-run is future work.

### Artifact contract (descriptive)

- Thin `JobResult.summary`: **`SystemSummary`** `{ headline, asOf }` — no
  `verdict`.
- Rich S3 JSON artifact: `facts` / `events` or `metrics` (code) + `narrative`
  `{ language, text }` (LLM) + provenance.
- Existing `TechnicalVerdict` / `FundamentalVerdict` enums remain in
  `@tuju/contracts` unused by PoC jobs.
- Wire phase `synthesizing-verdict` retained; means “drafting narrative” for PoC.

### TA facts (code)

Indicators: SMA 20/50/200, RSI-14, MACD (12,26,9), 52-week high/low.

Events: MA crosses (20×50, 50×200), price vs SMA-50/200 state, RSI band
(oversold/neutral/overbought as **labels only**), MACD line/signal cross, 52-w
proximity / new high, broke prior 20-session swing high.

### FA facts (code) + news (read model)

Metrics: trailing P/E, dividend yield, ROE, revenue & profit growth QoQ/YoY,
debt/equity, operating cash flow. Nulls are first-class (esp. banks D/E).

News: separate on-screen list (RSS/tagging primary; yfinance news optional;
empty allowed).

### LLM narration (OpenRouter)

- Client: existing OpenRouter seam; key via `OPENROUTER_API_KEY`.
- Default model: `google/gemini-2.5-flash` (override `LLM_MODEL`; free routes OK).
- Language: **Bahasa Malaysia** plain language; ~80–150 words.
- Hard bans: buy/sell/hold, targets, advice-shaped valuation calls.
- **Grounding pipeline:** build facts → prompt with facts only → narrate →
  number post-check → strip narrative on violation; skip LLM if facts empty.
- Accuracy claim: **facts 100% code-verifiable; LLM is language only.**

### One-screen surface

Route: `/stocks/:code` (KLCI 30).

Blocks: header · EOD chart (~2y) · TA card · FA card · news.

API sketch (schemas owned by later BE/contracts work):

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/stocks/:code` | Identity + snapshots |
| GET | `/stocks/:code/series?interval=1d&range=2y` | **PoC graduates chart fog** |
| GET | `/stocks/:code/analysis/technical` | Latest system TA result |
| GET | `/stocks/:code/analysis/fundamental` | Latest system FA result |
| GET | news scoped to code | Existing or thin wrapper |

States: pending / running / ready / facts-only (grounding fail) / failed /
stale-asOf / empty news — all honest, no fake filler.

### End-to-end flow

```
yfinance (.KL) → NestJS adapter ingest → Postgres
       → indicator/fundamentals snapshots
       → system enqueue analyze-technical ×30
       → system enqueue analyze-fundamental ×30
       → Python worker (facts → OpenRouter narrative → S3 + summary)
       → anonymous read APIs → one stock screen
```

## Out of Scope

- FE visual design system / chart library choice (→ **FE spec**).
- Adapter code, migrations, cron/CLI specifics, Zod HTTP schemas (→ **BE spec**).
- LangGraph graphs, exact prompts, goldens, per-job USD ceiling (→ **worker spec**).
- User-triggered paid enqueue, billing, accounts, watchlist, alerts.
- IPO / prospectus in the demo script; FCPO.
- Replacing or deleting the free-tier synthetic pipeline.
- Survey fieldwork, TTW homework, Lean Model Canvas copy edits (product
  homework in parallel).
- Public data licensing contracts.

## Candidate follow-ons

1. **FE spec** — implement the one screen against the read APIs + DESIGN.md.
2. **BE spec** — yfinance adapter, KLCI 30 seed, ingest + system enqueue, series +
   analysis read endpoints, persistence of latest results.
3. **Worker spec** — TA/FA handlers, grounding post-check, OpenRouter prompts.
4. **Optional additive contracts tweak** — rename `synthesizing-verdict` →
   `drafting-narrative` if desired (non-blocking).
5. **ADR note (execution time)** — short amendment/note that PoC reuses TA/FA job
   names with `trigger: 'system'` and verdict-less summaries (ADR-0005/0007
   already permit the shape; document the product policy).

## Acceptance (overarching)

- [ ] Map tickets 01–07 resolved (done in this wayfinding effort).
- [ ] This spec is the shared product source of truth for PoC / Phase A.
- [ ] Child FE/BE/worker specs can be written without re-opening universe,
      trigger, descriptive policy, fact defaults, or grounding rules.
- [ ] Demo script above is runnable once child specs are built.
