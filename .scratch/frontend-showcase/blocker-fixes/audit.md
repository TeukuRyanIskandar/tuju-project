# Audit: frontend-showcase tickets 01-05

**Date:** 2026-10-16
**Workspace revision:** `9f175ed` plus a large uncommitted working tree
**Scope:** What actually exists in the tree versus what tickets 01-05 claim, and
what blocks it.
**Method:** Static read of the tree. Every `file:line` below was verified against
the working tree on 2026-10-16.

## Limits of this audit — read first

- **No test suite was executed.** This audit ran in a read-only mode; no vitest,
  jest, pytest, playwright, `tsc` or `vite build` invocation. Every
  "passed: N tests" figure quoted in parent tickets 04 and 05 is therefore
  **unverified here**. They are internally plausible but unconfirmed.
- **No live data.** The backend was not started and no API was read. Data claims
  are quoted from [`../readiness.md`](../readiness.md), which recorded real
  reads on 2026-10-15.
- **No code was changed.** This document is the evidence input to
  [`spec.md`](spec.md); remediation lives in `issues/`.

## Everything under audit is uncommitted

> **Superseded 2026-10-16.** This section is a snapshot taken at audit time.
> A checkpoint commit has since landed (`8a42dc1`), and tickets
> [01](issues/01-contract-percent-scale.md),
> [02](issues/02-backend-fa-scale-producer.md),
> [03](issues/03-ai-worker-scale-passthrough.md) and
> [05](issues/05-artifact-timestamp-conformance.md) are resolved, so most of
> what is listed below is now committed. Reconciling the whole tracker against
> the tree is
> [16](issues/16-showcase-tracker-reconciliation.md)'s job, not this audit's.

`git log --oneline` shows no showcase commit. `git status --short` at audit time:

- Modified (tracked): `apps/backend/src/data/adapters/yfinance/*`,
  `apps/frontend/src/api/{ipo,stocks}.ts`, `apps/frontend/src/components/app-shell.tsx`,
  `apps/frontend/src/routes/{index,stocks.$code}.tsx`,
  `packages/contracts/src/http/stocks.ts`, `packages/contracts/test/fixtures.test.ts`,
  `services/ai/src/tuju_ai/jobs/pipeline.py`, plus `AGENTS.md`, `CONTEXT.md`
  files and `.gitignore`.
- Untracked: the whole of `apps/frontend/src/components/{market,stocks}/`,
  `apps/frontend/e2e/stock-detail.spec.ts`, `apps/frontend/src/api/{analysis-results,result-coherence}.ts`
  and their tests, `packages/contracts/test/browser-artifacts.test.ts`, and
  `.scratch/frontend-showcase/` itself.

There is no git checkpoint for any of it. A single careless `git checkout` or
`git clean` destroys the work.

---

## Blocker 1 — No demoable data (the real blocker)

Tickets 02-05 can be complete and the showcase still cannot be demonstrated,
because there is no complete stock and no complete prospectus.

| Measure | Actual | Required | Source |
| --- | --- | --- | --- |
| Complete stocks | 0 / 3 | >= 1 | `readiness.md:5`, `:101` |
| Prospectuses with summary + artifact | 0 / 2 | >= 1 | `readiness.md:90-99` |

Dependency chain: ticket 01 -> ticket 10 -> ticket 14, plus tickets 11 and 13.

### 1a. Unusable narration from the free model

Of 13 attempted TA/FA jobs, 9 failed terminally and 4 landed `facts_only`
(`readiness.md:41-56`, ticket 14). All 9 shared one terminal reason
(`readiness.md:46-49`):

```
LLM output was still invalid after the corrective retries: step 'narrate':
the model's reply was still unusable after 3 retries (Expecting value:
line 1 column 1 (char 0))
```

Code inspection gives a specific, testable hypothesis:

- `services/ai/src/tuju_ai/llm/openrouter.py:121` reads
  `text = choice["message"]["content"] or ""`. It discards `finish_reason`
  and any `reasoning` field the provider may return.
- `services/ai/src/tuju_ai/ta_fa_analysis.py:55` sets
  `NARRATE_MAX_TOKENS = 300`.
- `services/ai/src/tuju_ai/llm/structured.py:58-71` — `extract_json("")`
  reaches `json.loads("")`, which raises exactly
  `Expecting value: line 1 column 1 (char 0)`.
- `services/ai/src/tuju_ai/llm/structured.py:37-38` — free routing retries 3
  times, so all 4 attempts return the same empty-content failure.

A reasoning-tier free model can spend the entire 300-token budget on
`reasoning` and return empty `content`. That matches the evidence (announcement
jobs, which use a different token budget, all succeeded; 52 HTTP 200 responses
were counted, so the provider was answering). **This is a hypothesis, not a
proven cause.** `readiness.md:51-53` is explicit that the underlying cause is
not established and no 429/auth/outage conclusion is supported.

The consequence for honesty: an *empty* reply is currently reported as a
*malformed shape* reply. The terminal reason misdescribes what happened.

### 1b. Artifact timestamps fail their own contract

`GET /stocks/5326/analysis/technical/artifact` is HTTP 200 but fails
`TechnicalAnalysisArtifact.omit({cost: true })` on two fields
(`readiness.md:74-88`):

- `asOf`: `2026-10-15 04:25:29.756000+00:00`
- `provenance.generatedAt`: `2026-10-15 06:45:32.611010+00:00`

Both are the same instant as the envelope's valid ISO values, but space-separated
rather than ISO 8601, so the wire contract rejects them. Reproduced on re-read
twice at `06:57:19Z`. That artifact was the **only** non-404 artifact in the
whole deployment, so it is the only thing standing between 1 stock and "complete".

**Partial progress, unrecorded anywhere in the tracker.** The working tree
already contains the fix — `services/ai/src/tuju_ai/jobs/pipeline.py` now does
`artifact = validated.model_dump(mode="json", by_alias=True, exclude_unset=True)`
before `put_artifact`, replacing the previous `json.dumps(..., default=str)`
path. The added regression in `services/ai/tests/test_job_pipeline.py` asserts
this against a **toy** `Nested`/`WireArtifact` Pydantic model, not the generated
`TechnicalAnalysisArtifact` / `FundamentalAnalysisArtifact`. Ticket 14's
acceptance criterion "timestamps pass **actual** contracts" is therefore not met.

> **Correction — 2026-10-16, ticket
> [05](issues/05-artifact-timestamp-conformance.md) resolved.** The finding
> above was accurate when written and is preserved as the historical audit, but
> two parts of it are no longer current.
>
> 1. **The toy-model regression was not the only one.** `c181bd2` (ticket 03,
>    committed) added
>    `test_ta_fa_analysis.py::test_ta_fa_captured_timestamp_bytes_against_source_ts_contracts`,
>    which runs real TA and FA artifacts through the full `JobDefinition` →
>    `put_artifact` → read-stored-bytes path with the **generated**
>    `TechnicalAnalysisArtifact` / `FundamentalAnalysisArtifact` as the contract,
>    then hands the exact stored bytes to the source TS schemas. It landed after
>    this section was written.
> 2. **One gap in that regression was real, and is now closed.** The captured
>    bytes were only ever validated against the *stored* schemas.
>    `browser-artifacts.test.ts` checks the cost-stripped browser shape against
>    golden fixtures, never against bytes the pipeline actually wrote — so
>    nothing proved the two shapes agree on a real artifact, which is exactly the
>    schema the live 200-but-fails failure hit. `fixtures.test.ts` now asserts
>    both against the captured bytes.
>
> Narrower than stated above, too: the defect only ever affected `asOf` and
> `provenance.generatedAt`, the two fields written as native Python values.
> `TechnicalEvent.at` and `FundamentalMetric.asOf` arrive from the backend as
> strings, and the prospectus artifact pre-writes `isoformat()`, so
> `json.dumps(default=str)` was a no-op on both. The prospectus path never had
> this defect.

### 1c. Blockers that are not technical

- Ticket 11 (market cold-start / mixed data) — `ready-for-human`.
- Ticket 13 (news source policy) — `ready-for-human`, blocked on a source policy
  decision.
- Private hosting and non-redistribution rights review — operator action,
  `readiness.md:10`.
- Prospectus inputs are **Part-1-only** PDFs (`readiness.md:20-22`). Even after
  generation, absent sections must not be described as absent in the issuer's
  complete prospectus.

---

## Blocker 2 — The tracker misstates all five tickets

| Ticket | Header says | Reality |
| --- | --- | --- |
| 01 data readiness | `needs-info` | Accurate. |
| 02 contracts and queries | `ready-for-agent` | Substantively implemented and uncommitted. |
| 03 market overview | `ready-for-agent` | Implemented, and **no implementation or verification comment exists at all**. |
| 04 stock header chart | `ready-for-agent` | Implemented; comment present but partly false (below). |
| 05 analysis panels | `ready-for-agent` | Implemented; comment present. |

Specific drift:

- Parent `issues/04-stock-header-chart.md:77` states TA/FA slots were "reserved
  only, with **no analysis requests** or jobs". That is now false:
  `apps/frontend/src/components/stocks/stock-detail.tsx:78-79` mounts
  `TechnicalAnalysisPanel` and `FundamentalAnalysisPanel`, which do issue
  reads. Parent ticket 05's comment acknowledges replacing 04's placeholders;
  ticket 04's own record was never corrected.
- Parent ticket 04's verification figures are stale, not fabricated: it claims
  "5 Chromium tests" and "20 files, 282 tests". At audit time the tree has 6
  (`e2e/smoke.spec.ts` 3 + `e2e/stock-detail.spec.ts` 3) and 23 test files.
  Ticket 05's later figures (6 / 23 / 329) match the tree.
- Bundle-size figures in both comments (`9.82 kB`, `21.22 kB`) are not
  reproducible read-only.

---

## Blocker 3 — Code defects

Severity is relative to this milestone's honesty and accessibility commitments
in [`../spec.md`](../spec.md).

### Frontend

| # | Severity | Finding | Evidence |
| --- | --- | --- | --- |
| F1 | High | Provenance fallback labels **any** value that is not `synthetic` or `aggregator` as "Real source". Production `apiGet` skips runtime validation, so a missing or unknown provenance is presented to a user as real data. The sibling implementation gets this right. | `components/market/market-overview.tsx:24-28` vs `components/stocks/stock-detail.tsx:16-19` |
| F2 | High | Percentage scaling is a hardcoded per-metric-id table. The contract's `unit` is a bare `z.string()` with no scale marker, and the same metric id has **opposite** scaling under the two unit vocabularies in use. Correct against today's producer, silently wrong if the producer changes. | `components/stocks/analysis-presentation.ts:22-24`; contract `packages/contracts/src/artifact.ts:472` |
| F3 | Low | Duplicate identical `role="alert"` "Analysis detail unavailable" when a detail read errors while a retained pair is present but malformed. No test covers the combination because every test uses a singular `getByRole('alert')`, which throws on duplicates. | `components/stocks/stock-analysis-panel.tsx:53-54` |
| F4 | Low | The EOD close/date line renders outside `ReadState`, so on load or failure the header shows `Series EOD close: — · Trading date: —` with no explanation; the error appears only in the history panel below. | `components/stocks/stock-detail.tsx:53` |
| F5 | Low | Identity-mismatch guards `throw` a plain `Error` from inside `select`. `lib/query-client.ts` only special-cases `ApiError` and `ContractParseError`, so each mismatch triggers 2 retries, i.e. 3 GETs per code per query. | `components/stocks/stock-detail.tsx:38-45` |
| F6 | Low | Volume bars use `--chart-6`. `DESIGN.md:121` requires `--up`/`--down` for volume, and `DESIGN.md:139-141` records `--chart-6` as a documented near-match of `--info` (worst-case dE 4.0). | `components/stocks/stock-history-chart.tsx:44` |
| F7 | Medium | A test-only fixture module sits in production source and `?raw`-imports two contract fixture JSON files. Only a test imports it today; any production import would inline both blobs into the bundle. | `components/stocks/analysis-fixtures.ts:1-3` |
| F8 | Low | `CONTEXT.md` documents an `ensureQueryData` loader convention. There are **zero** occurrences of `ensureQueryData` in `apps/frontend/src`. The convention sentence is now false app-wide. | `apps/frontend/CONTEXT.md:12` |
| F9 | Low | Dead code presented as meaningful: `placeholderData: undefined` is the TanStack default and sold in a comment as an explicit guarantee; `key={...}` on the analysis panels is redundant because the route already remounts on code change. | `components/stocks/stock-detail.tsx:37-45, 78-79` |
| F10 | Low | `export function HistoryChart` has no external importer. `stockCorporateActionsQuery` has no consumer. Ticket 03's work item "share chart primitives with stock work" is not done; two independent SVG chart implementations exist with duplicated `<details>`/table scaffolding. | `components/market/market-overview.tsx:46`; `api/stocks.ts:135-152`; `components/market/market-overview.tsx:46-73` vs `components/stocks/stock-history-chart.tsx:7-67` |

### Root cause of F2 — the producer, not just the contract

`apps/backend/src/stocks/analysis-reference.ts:103-201` stamps `unit: '%'` on
two genuinely different scales:

| Metric ids | Stamped unit | Actual scale | Why |
| --- | --- | --- | --- |
| `dividend_yield` (`:117`), `roe` (`:124`) | `'%'` | **fraction** | `data/synthetic/ratios.ts:119-143` returns `dps / close` and `profit / equity` raw, so 0.045 means 4.5%. |
| `revenue_growth_qoq` (`:154`), `profit_growth_qoq` (`:177`) | `'%'` | **percentage point** | computed as `((q0 - q1) / abs(q1)) * 100`, already multiplied by 100. |
| `revenue_growth_yoy`, `profit_growth_yoy` | `'%'` | n/a | always `null`. |
| `trailing_pe`, `debt_to_equity` | `'x'` | ratio | — |
| `operating_cash_flow` | `'RM bn'` | unconverted, always `null` | never ingested. |

The golden fixture uses a third vocabulary entirely — `ratio`, `percent`, `myr`
(`packages/contracts/fixtures/fundamental-analysis-artifact.json`). So the
frontend's per-id table is compensating for a producer inconsistency, not merely
a missing contract field. Fixing only the frontend would leave the ambiguity in
place for every future consumer.

### Verified correct — do not "fix" these

- **Browser cost-free schemas are non-invasive.**
  `packages/contracts/src/http/stocks.ts:178-181` derives
  `TechnicalAnalysisArtifact.omit({ cost: true })` and the fundamental
  equivalent. Stored schemas still require `cost`. `src/jsonSchema.ts` registers
  only `enums/payloads/envelope/result/artifact` and `modelOrder` has no browser
  entries, so `.omit()` clones stay out of codegen and the Python models.
- **Query keys are genuinely isolated.** `api/stocks.ts:38-44` folds `kind`,
  result identity (asOf, bucket, key, artifactPath), code and jobName into the
  artifact key; series carries literal `1d`/`2y`.
- **Pointer fields are identity only.** Transport always uses the fixed encoded
  backend route through `apiGet`, never a response-provided URL
  (`api/stocks.ts:86, 105`).
- **Mismatch reads are bounded at exactly two.** `api/result-coherence.ts:80-86`
  loops at most twice and returns `mismatch` as data, so Query retry never
  multiplies it. HTTP and schema errors still throw.
- **All nine FA metrics render** with unit and per-metric date; missing or
  duplicate rows become "Unavailable — missing or duplicate metric" rather than a
  fabricated zero (`components/stocks/fundamental-analysis.tsx:8-15`).
- **Zero is distinct from null** — `metricValue` returns the unavailable string
  only for `null`/non-finite (`analysis-presentation.ts:21`).
- **Facts-only suppression is a byte-for-byte match** against both worker
  placeholder narratives, which are defined at
  `services/ai/src/tuju_ai/ta_fa_analysis.py:42-49`
  (`analysis-presentation.ts:29-33`, `stock-analysis-panel.tsx:36, 47-48, 63`).
- **AI explanation and computed facts are structurally separate** —
  `<h3>Computed facts</h3>` in both fact components,
  `<h3>AI explanation</h3>` with an AI-generated label and `lang` attribute in
  `stock-analysis-panel.tsx:62-63`.
- **No advice, score or invented interpretation.** Event rows come from producer
  `label`/`values`, and fired vs not-fired is explicit
  (`technical-analysis.tsx:17`).
- **Headline index is selected by `kind`,** never a hardcoded id or name
  (`market-overview.tsx:132`). No hardcoded index UUID, stock code or KLCI/FBM
  name exists anywhere in audited production code.
- **Range and movers controls hit real query params** — 1m/3m/1y and
  gainers/losers/actives with `limit: 10`, gainers default
  (`market-overview.tsx:76, 80, 94-95`).
- **Local window filtering issues no extra request** (`stock-history.ts:41-53`).
- **Malformed/empty series never plot zero or NaN**
  (`stock-history.ts:5-11, 20-23, 33-35`; `stock-history-chart.tsx:12-14`).
- **No analysis enqueue from the browser.** No POST, no `refetchInterval`, no
  component `fetch`, no subscription API in any audited file.

## Spec requirements deliberately not met here

These are tracked elsewhere and are **not** part of this effort:

- `spec.md:58-60` asks to hide Screener/Announcements/Calendar/News from primary
  navigation. `components/app-shell.tsx:5-11` still lists them. This is ticket
  07's job.
- `spec.md:179` wants stale results to warn they *trail latest stored EOD data*.
  The panel renders only "Stale result — not current"
  (`stock-analysis-panel.tsx:50`); it has no latest-EOD date to compare against.
- `spec.md:110` specifies the label `Automatic analysis unavailable`; the panel
  renders "Analysis is not available for this stock."
  (`stock-analysis-panel.tsx:42`).
- `stock-detail.tsx:21-23` does not branch on `ApiError.status`, so an unknown
  stock (404) and a 5xx show the same generic "Panel unavailable". Only the
  analysis path distinguishes them. `spec.md:107-110` asks that they be
  distinguishable.

## Ticket cross-reference

| Remediation | Ticket |
| --- | --- |
| F1 | [10](issues/10-market-provenance-honesty.md) |
| F2 and its producer root cause | [01](issues/01-contract-percent-scale.md), [02](issues/02-backend-fa-scale-producer.md), [03](issues/03-ai-worker-scale-passthrough.md), [04](issues/04-frontend-scale-presentation.md) |
| F3 | [11](issues/11-analysis-panel-duplicate-alert.md) |
| F4, F5 | [12](issues/12-stock-detail-panel-honesty.md) |
| F6, F10 (primitives half) | [13](issues/13-chart-design-conformance.md) |
| F7 | [14](issues/14-fixture-module-boundary.md) |
| F8, F9, F10 (dead half) | [15](issues/15-doc-drift-and-dead-code.md) |
| Blocker 2 | [16](issues/16-showcase-tracker-reconciliation.md) |
| Blocker 1a | [06](issues/06-openrouter-response-diagnostics.md), [07](issues/07-empty-vs-malformed-reply.md), [08](issues/08-narration-empty-content-remedy.md) |
| Blocker 1b | [05](issues/05-artifact-timestamp-conformance.md) |
| Blocker 1 end-to-end | [09](issues/09-bounded-rerun-readiness-reaudit.md) |