# Context: Frontend (`@tuju/frontend`)

TanStack Start 1.x app for **Product A**, built as a **static SPA** (ADR-0005).
SSR stays in the box but is deliberately unused for v1; enabling it later is
additive, not a rewrite.

## Responsibility

- Render Product A's dashboard as a static SPA (`spa.enabled: true`); the
  production build prerenders only the root shell (`_shell.html`). No FE server
  on the request path (ADR-0005).
- Talk to the backend through a **configurable API base** (`VITE_API_BASE_URL`,
  `src/lib/api.ts`) — never hard-code backend URLs.
- Send `credentials: 'include'`; the session token is httpOnly and never touches
  client JS (ADR-0005).
- Read every backend endpoint through `apiGet(path, schema)` (`src/lib/api.ts`),
  wrapped per area in `src/api/` as TanStack Query key factories and
  `queryOptions` builders. Route loaders call
  `context.queryClient.ensureQueryData(xQuery(...))`; components use the same
  builders with `useQuery`.

## Boundaries

- **Tier = show/hide only.** `src/lib/auth.ts` reads `tier` from `/auth/me` for
  presentation and asks capability questions (`canRunJob`); it never enforces.
  The backend always re-checks at the enqueue seam.
- Consumes `@tuju/contracts` via `workspace:*`: TS types (e.g. `JobName`) and,
  since the data layer, runtime values too — the HTTP response Zod schemas,
  `ProspectusArtifact` and `parseOrThrow` (ADR-0014). No cross-language imports
  (ADR-0002).

## Data layer

- `apiGet(path, schema, init?)` returns the schema's output type. A non-2xx
  response throws `ApiError` (`status`, `body`, `path`). Response bodies are
  validated with `parseOrThrow` from `@tuju/contracts` (throws
  `ContractParseError`) in dev and test only; production builds skip validation
  (`VALIDATE_RESPONSES`).
- `src/api/<area>.ts` holds one key factory and the `queryOptions` builders for an
  area (search, stocks, screener, announcements, calendar, news, market, brief,
  ipo, auth). Add a new endpoint there, with its schema from `@tuju/contracts`;
  do not call `fetch` from components or routes.
- The `QueryClient` is created per `getRouter()` (`src/lib/query-client.ts`) and
  sits in the router context (`RouterContext` in `src/router.tsx`). Defaults:
  `staleTime` 60s; no retry on 4xx `ApiError` or `ContractParseError`, at most 2
  retries otherwise.

### Analysis reads (stock TA/FA and IPO)

- `stocks.ts` supplies the fixed `1d`/`2y` series, thin TA/FA envelopes and
  cost-free rich reads; `ipo.ts` supplies the prospectus equivalents (IPO keeps
  its existing artifact schema). Rich builders require expected thin metadata;
  missing/wrong resource metadata disables them and imperative reads return
  `unavailable`. Keys include resource/kind and expected date, pointer and path.
- Pointer buckets/keys and `artifactPath` are **identity only**. Transport always
  uses the fixed encoded backend API route through `apiGet`, never an S3 URL or
  a response-provided URL.
- `result-coherence.ts` returns `matched`, `mismatch` or `unavailable`. TA/FA
  check symbol, kind and normalized exact `asOf` (preserving sub-ms precision).
  IPO checks ID/headline and generation at-or-after thin `asOf`: that timestamp
  is the job timestamp, not the artifact's `generatedAt`. A mismatch repeats the
  artifact HTTP read once, then returns data rather than triggering Query retry.
  HTTP/schema errors still throw normally; both reads use Query's abort signal.
- `analysis-results.ts` provides fixed-resource lifecycles via
  `stockTechnicalResults`, `stockFundamentalResults`, `prospectusResults`.
  `refreshSummary()` loads thin data independently; `refreshDetail()` reads
  against that summary; `refresh()` forces a summary-then-artifact refresh even
  with fresh cached data. Inspect `getState()` for independent thin/detail errors,
  mismatch/unavailable/loading and an explicitly labelled `previousPair` holding
  its **own** summary and artifact. Never pair it with the new thin summary.
  Create a new lifecycle on stock/kind/prospectus change; no previous pair crosses
  identities. Superseded async completions cannot overwrite current state.
  No polling or UI hooks are installed by this layer.
- Latest-pointer reads are not atomic. These visible metadata checks cannot prove
  artifact provenance when distinct runs have indistinguishable metadata; IPO
  generation has only a lower bound, not an expected exact generation timestamp.

## Design

Visual language, tokens and chart patterns live in [`DESIGN.md`](DESIGN.md).

## Glossary

- **Static SPA** — the v1 build target; CDN-served assets, no FE request-path server.
- **Configurable API base** — the `VITE_API_BASE_URL` indirection that is the
  ADR-0005 lever toward a future BFF/proxy.
- **`apiGet`** — the typed GET through the configurable base; throws `ApiError`
  on non-2xx.
- **Capability (FE)** — a presentation-only question derived from tier; drives
  show/hide, never authorization.

## Commands

```bash
pnpm --filter frontend dev        # dev server on :5173
pnpm --filter frontend build      # static SPA bundle
pnpm --filter frontend test       # vitest
pnpm --filter frontend typecheck  # tsc --noEmit
```

`src/routeTree.gen.ts` is generated by the TanStack Router plugin and is gitignored.

## Decisions

System-wide ADRs in `docs/adr/` govern this context (esp. ADR-0005, ADR-0010,
ADR-0002, ADR-0014). No context-scoped ADRs yet.
