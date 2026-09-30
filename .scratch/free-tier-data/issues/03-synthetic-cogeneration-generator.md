# Build ticket: Synthetic co-generation generator (seeded, reconciled)

Type: task
Status: resolved
Blocked by: 01

> Execution effort breaking down
> [spec 01 — data ingestion + domain model](../../free-tier-specs/01-data-ingestion-and-domain-model.md).
> **Wave 1 — parallelisable with ticket 02 (adapter seam).** Both depend only on
> ticket 01's committed entities; they converge in the worker (ticket 04).
> Fixed inputs: ADR-0001–0011, `apps/backend/CONTEXT.md`, the entities in
> `apps/backend/src/data/entities/` (esp. `SyntheticRun`, `PriceBar`,
> `QuarterlyFinancials`, `FundamentalsSnapshot`).

## Scope (this ticket only)

A **deterministic, seeded generator** that co-produces the reconciled 3-year timeline
(decision A1): daily `PriceBar`s (~750 trading days, warms SMA-200) **and** the
`QuarterlyFinancials` (12 quarters) + `FundamentalsSnapshot` figures for a company,
such that **every derived ratio reconciles** (P/E, market cap, DY, P/NTA, ROE, D/E,
PSR all agree). Output is a pure in-memory dataset keyed to a `SyntheticRun`
(seed + params); **persistence is ticket 04's job** — this ticket is pure computation
+ its reconciliation guarantee.

### Requirements (from spec 01)

- **One seed → one exact timeline.** Same seed + params reproduces byte-identical
  output (the `SyntheticRun` is a regenerable, purgeable unit).
- **Shares outstanding held constant** across the timeline (trivial A1 reconciliation).
- Emit a small **intangibles** line so **P/NTA ≠ P/B**.
- Emit fundamentals line items the ratio definitions need: revenue, net profit, EPS,
  equity, NTA, intangibles, total borrowings — per fiscal quarter.
- Produce data as plain DTOs matching entity fields (prices as exact `numeric` strings,
  scale per `PriceBar`); the generator does **not** touch TypeORM/DB.
- Ratio definitions to reconcile against (spec 01 "Ratio definitions"):
  - **P/E** = price ÷ TTM EPS; **null when TTM EPS ≤ 0**.
  - **DY** = TTM dividend-per-share ÷ price (dividends come from `CorporateAction`;
    coordinate the shape with ticket 04, or emit a dividend stream this generator owns).
  - **P/NTA** = price ÷ NTA/share; NTA/share = (equity − intangibles) ÷ shares.
  - **ROE** = TTM net profit ÷ average equity (opening+closing over TTM).
  - **D/E** = total borrowings ÷ latest equity.
  - **PSR** = market cap ÷ TTM revenue; market cap = price × shares.
  - **YoY / consecutive growth** = quarter vs same quarter one year prior.

## Out of scope (other tickets)

- Adapter interfaces / DI wiring — **ticket 02** (this generator is what
  `SyntheticMarketDataAdapter`/`FundamentalsAdapter` delegate to).
- Persistence, crons, worker process, indicator computation (`trading-signals`),
  ratio *materialisation onto rows*, ADR-0012 — **ticket 04**.
- Intraday replay (Redis-only) — ticket 04.

## Testing seam (TDD)

Unit tests, no live DB — the reconciliation is deterministic from the seed:

- **Reconciliation test (the A1 guarantee):** given a fixed seed, compute P/E, market
  cap, DY, P/NTA, ROE, D/E, PSR from the emitted bars + fundamentals and assert they
  all agree with the generator's own derived figures. Table-driven over the pinned
  edge cases (loss-maker → P/E null; DY on TTM dividends; ROE on **average** equity;
  YoY same-quarter).
- **Determinism test:** same seed + params → identical output across two runs.
- **Backfill-shape test:** ~750 trading days of bars, 12 quarters of financials,
  shares outstanding constant across the span.

Prior art: none yet in-repo for numeric gen; keep it a pure module for testability.

## Answer

Landed a **pure, deterministic, seeded** synthetic co-generation module under
`apps/backend/src/data/synthetic/` — no TypeORM/DB access, no `Math.random`, no
wall clock. Same `seed` + `params` ⇒ byte-identical output. Nothing in
`src/data/entities/`, the migration, or `src/data/adapters/` was touched.

### Files

- `prng.ts` — seeded PRNG (splitmix32 seeding + mulberry32 stream + Box–Muller
  Gaussian) and `deriveSeed(base, label)` so `prices`/`volume`/`financials`/
  `dividends` are independent, reproducible streams.
- `decimal.ts` — exact fixed-point decimal (`{ units: bigint, scale }`) with
  `add/sub/mul/divide/rescale/cmp` and fixed-scale string rendering. `divide`
  is the single reconciliation primitive (half-up away from zero). This is why
  every ratio reconciles exactly against the emitted `numeric` strings.
- `types.ts` — plain DTOs mirroring entity field shapes (`PriceBarDto`,
  `QuarterlyFinancialsDto`, `CorporateActionDto`, `FundamentalsSnapshotDto`),
  `SyntheticParams`, `SyntheticDataset`, pinned `SCALE` map (price 6, money 2,
  eps 6, ratio 6, dividend 6), and `DEFAULT_PARAMS` (credible mid-cap, 750
  trading days / 12 quarters / constant 500M shares).
- `ratios.ts` — the ratio definitions computed **only** from emitted DTOs
  (P/E null when TTM EPS ≤ 0, DY on TTM dividend actions, P/NTA on
  (equity−intangibles)/shares, ROE on **average** equity, D/E, PSR = price×shares
  ÷ TTM revenue, YoY consecutive growth same-quarter).
- `generator.ts` — `generate(seed, params)` co-produces bars (GBM walk, weekday
  trading days ending at `endDate`, OHLC bracketed), 12 quarters (compounding
  revenue, net margin, equity walk, intangibles line so **P/NTA ≠ P/B**,
  borrowings, EPS = netProfit÷shares), a dividend stream, and the materialised
  snapshot built through `ratios.ts` (reconciliation by construction).
  Dependency-free UTC date math (Sakamoto day-of-week, leap-aware).
- `index.ts` — barrel: `generate`, `ratios`, DTO types, `SCALE`, `DEFAULT_PARAMS`.

### Module API

```ts
import { generate, DEFAULT_PARAMS, type SyntheticDataset } from './data/synthetic';
const ds: SyntheticDataset = generate(seed, DEFAULT_PARAMS);
// ds.priceBars, ds.quarterlyFinancials, ds.dividends, ds.snapshot
```

### Tests (TDD, unit lane — no DB)

- `decimal.spec.ts` (8 tests): parse/render, half-up rounding, division to fixed
  scale, negatives, divide-by-zero throw, `mul` scale-sum, `cmp` across scales.
- `generator.spec.ts` (22 tests): **reconciliation (A1)** — P/E, TTM EPS/rev/np,
  P/NTA (+ explicit P/NTA≠P/B), ROE on average equity, D/E, PSR, DY on TTM
  dividends, consecutive YoY growth all recomputed independently (the test does
  NOT import `ratios.ts`) and asserted equal to the snapshot; **edge cases** —
  `forceLatestLoss` ⇒ TTM EPS ≤ 0 ⇒ P/E null, profitable default ⇒ P/E non-null;
  **determinism** — same seed byte-identical, different seed differs, shares
  constant across seeds; **backfill-shape** — 750 bars weekday/ascending/unique,
  12 ascending unique quarters, fixed-scale numeric-string formats, high/low
  bracket open/close.

### Verification (Windows / PowerShell)

- `pnpm --filter @tuju/backend typecheck` → exit 0.
- `pnpm --filter @tuju/backend test` → **8 suites, 86 tests passed** (all
  pre-existing suites plus the 2 new synthetic suites; the 2 new suites are 30
  tests: `pnpm --filter @tuju/backend test -- src/data/synthetic` → 30 passed).

Left in the working tree, uncommitted, for review.
