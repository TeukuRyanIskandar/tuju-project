# Data layer: TanStack Query and typed API client

Type: task
Status: done
Blocked by: 01, 05

## Task

- Add TanStack Query. Put the `QueryClient` in the router context; loaders use
  `ensureQueryData`.
- `apiGet(path, schema)`: typed, validates against the contracts schema in dev
  and test. Decide whether validation stays on in production (default: off).
- `ApiError` carries the status code and body.
- Query-key and fetch functions per area in `src/api/`.

## Done when

Unit tests cover `apiGet` success, a non-2xx response, and a schema failure.

## Comments

**Decision (with the user): response validation.** `apiGet` validates with
`parseOrThrow` when `VALIDATE_RESPONSES = import.meta.env.DEV || import.meta.env.MODE === 'test'`;
production builds skip it. Contract objects are strict, so in prod an unannounced
backend field would break a page for no user benefit. "Warn-only in prod" (parse,
report, still return the data) is the later escape hatch once error reporting
exists.

**Also decided:** `src/api/` covers all backend read endpoints; `fetchSession`
now goes through `apiGet` (`ApiError` 401/403 -> `null`, other statuses reject
with `ApiError`).

**Built:** `ApiError`, `apiGet`, `withQuery` in `src/lib/api.ts`;
`src/lib/query-client.ts` (`staleTime` 60s; no retry for 4xx `ApiError` /
`ContractParseError`, max 2 otherwise); `QueryClient` per `getRouter()` in router
context, with `QueryClientProvider` via `Wrap`, and
`createRootRouteWithContext<RouterContext>()`; `src/api/{search,stocks,screener,announcements,calendar,news,market,brief,ipo,auth}.ts`.
`@tanstack/react-query` 5.104.1 and `zod` 4.6.5 added pinned.

**Verified:** `pnpm --filter @tuju/frontend test` (176 tests, incl. `apiGet`
success, non-2xx `ApiError` with status/body, schema failure
`ContractParseError`, prod-mode skip, `withQuery`, query-builder URLs/keys),
`typecheck` and `build` pass. Not verified: against a running backend; no route
uses the loaders yet (that lands with the first page ticket).

**Follow-up:** the IPO artifact query (`GET /ipo/:id/at-a-glance/artifact`) is
omitted because `ProspectusArtifact` is not in `@tuju/contracts` yet (ticket 02).
Add `src/api/ipo.ts` `prospectusArtifactQuery` once it lands.
