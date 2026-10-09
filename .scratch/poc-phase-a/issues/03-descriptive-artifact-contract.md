# Decide: descriptive artifact contract (no buy/sell signals)

Type: grilling
Status: resolved
Blocked by: 02, 04, 05

## Question

Pitch Feedback: **descriptive** TA/FA summaries, never buy/sell. Accuracy = code
computes facts, LLM only narrates; narration must only contain computed numbers.

Contracts today require `Summary.verdict` ∈
`bullish|bearish|neutral` / `undervalued|fairly-valued|overvalued` for TA/FA
(`packages/contracts` `Summary` vs verdict-less `SystemSummary`).

Decide the PoC wire + artifact shape so we do not ship investment-advice-shaped
verdicts while still fitting ADR-0007.

## Answer

**PoC TA/FA emit verdict-less thin summaries (`SystemSummary`) + a structured
facts+narrative S3 artifact. Existing Verdict enums stay in the package for a
future paid path but are not used by PoC jobs.**

### Thin wire summary

- Use **`SystemSummary`**: `{ headline, asOf }` (already on `JobResult.summary`
  union for showcase jobs).
- `headline` = one descriptive sentence grounded in the top fact (BM preferred),
  e.g. “RSI 14 pada 62; SMA-50 baru dipotong naik minggu ini.” — **no** “beli” /
  “jual” / “undervalued” / “bullish call”.
- Progress phases: keep existing `TechnicalPhase` / `FundamentalPhase` including
  `synthesizing-verdict` on the wire (additive rename to `drafting-narrative` is
  optional in a later worker/contracts ticket — not required to ship PoC).

### Rich S3 artifact (opaque JSON, claim-checked)

```
{
  symbol, jobName, asOf, timeframe|period,
  facts: { ... structured, numbers as numbers ... },
  events: [ { id, label, value, at, ... } ],  // TA
  metrics: [ { id, label, value, unit, ... } ], // FA
  narrative: { language: "ms"|"en", text: "..." },
  provenance: { source: "real", adapter: "yfinance", ... }
}
```

- **facts/events/metrics** are produced **only by code** (worker or precomputed
  snapshots). LLM never invents or edits this block.
- **narrative** is LLM output constrained by ticket 06 grounding rules.
- Artifact `contentType: application/json`.

### What we deliberately do not do in PoC

- Do not populate `Summary.verdict`.
- Do not show traffic-light “buy/sell/hold” UI.
- Do not delete Verdict enums (paid product may later use softer tone labels with
  legal review — separate effort).

### Contract delta for execution (flag for BE/worker specs)

- Confirm worker return path for TA/FA accepts `SystemSummary` (already allowed by
  `JobResult.summary` union).
- Document PoC policy in the overarching spec; any Zod tightening (e.g. per-job
  summary variant) is additive and owned by a later contracts touch if needed.
