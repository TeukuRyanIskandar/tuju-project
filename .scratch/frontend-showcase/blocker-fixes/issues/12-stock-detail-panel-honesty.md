# 12 — Make the stock detail header honest about missing EOD data

Type: bug
Status: ready-for-agent
Blocked by: none
Severity: medium
Component: `apps/frontend`

## Problem

Two related honesty defects in the stock detail screen: an unexplained blank
value in the header, and unknown-stock indistinguishable from a server fault.

## Evidence

**12a — EOD line outside the read state.**
`apps/frontend/src/components/stocks/stock-detail.tsx:53`:

```tsx
<p className="num mb-2 break-words text-base">Series EOD close: {formatRm(latest?.close, { decimals: 3 })} · Trading date: {latest ? formatDate(latest.date) : '—'}</p>
```

This renders outside the `<ReadState>` wrapper that begins at `:54`. On initial
load and on series failure the header therefore reads
`Series EOD close: — · Trading date: —` with no explanation, while the actual
error appears further down inside the "Daily EOD history" panel. Parent ticket 04
claims failures stay panel-local, and the error message here is arguably in the
wrong panel relative to the value the user is looking at.

**12b — Identity mismatch causes triple fetches.**
`stock-detail.tsx:38-45` guards against a response for the wrong code by throwing
a plain `Error` from inside `select`:

```ts
select: data => { if (data?.identity?.stockCode !== code) throw new Error('Stock identity mismatch'); return data }
```

`apps/frontend/src/lib/query-client.ts` only suppresses retries for `ApiError` and
`ContractParseError`. A plain `Error` does not match, so each mismatch triggers
the default 2 retries — **3 GETs per query per code** for a condition that is a
guard, not a transient fault.

## Root cause

**12a:** the header renders a value sourced from a query whose read state it does
not consume.

**12b:** a deliberate correctness guard was written as an exception, and the retry
policy classifies by exception type.

## Fix

### 12a

1. Move the EOD line inside `ReadState` for the series query so the header state
   and the explanation travel together.
2. Preserve the requirement from parent ticket 04's acceptance criteria: "Latest
   EOD date is distinguished from retrieval/analysis timestamps." The wording is
   already correct — keep "Series EOD close" and "Trading date" distinct from the
   "Retrieved ... not a quote timestamp" line at `:29`.
3. Do not let this make core and series failures interdependent. The parent AC
   requires each to stay local.

### 12b

4. Either throw a `ContractParseError` (already imported from
   `@tuju/contracts` elsewhere in this app and already special-cased) or narrow
   the retry predicate to treat this guard as non-retryable. Prefer whichever the
   existing `query-client.ts` conventions favour; do not add a third exception
   type for one call site.
5. Add a test asserting an identity-mismatched response produces **one** request,
   not three.

## Acceptance criteria

- A failed or loading series read shows an explanation adjacent to the header EOD
  value, not a bare em-dash pair.
- An identity-mismatched response triggers exactly one HTTP request per query.
- Core-read and series-read failures remain independent; neither makes the other
  disappear.
- EOD date, retrieval time and analysis timestamps stay distinctly labelled.

## Verification

```bash
pnpm --filter frontend test
pnpm --filter frontend typecheck
pnpm --filter frontend test:e2e
```

Parent ticket 04's timezone runs must still pass — 31 tests each under
`TZ=America/Los_Angeles` and `TZ=Pacific/Kiritimati` over
`stock-history.test.ts` and `stock-history-chart.test.tsx`.

## Limits

- Do not change the unknown-stock-versus-server-fault presentation in this
  ticket. `stock-detail.tsx:21-23` does not branch on `ApiError.status`, so a 404
  unknown code and a 5xx both show "Panel unavailable". The parent spec
  (`spec.md:107-110`) asks for these to be distinguishable, but that is a
  presentation decision worth its own ticket, not a drive-by fix.
- Also out of scope: the label mismatch where the spec says
  `Automatic analysis unavailable` and the code renders "Analysis is not available
  for this stock." (`stock-analysis-panel.tsx:42`). Note it, do not bundle it.
- No runtime validation changes to `apiGet`.