# Backend adopts contracts types

Type: task
Status: done
Blocked by: 01, 02

## Task

- `stocks.types.ts`, `market.types.ts`, `disclosures.types.ts`,
  `screener-query.interface.ts` and the IPO mapping re-export from
  `@tuju/contracts` or are removed.
- Every read controller gets an explicit return type from contracts.
- Integration tests parse at least one response per endpoint with its schema.
- The backend uses `moduleResolution: "Node"`. Check it resolves the contracts
  root export. If not, flag it; do not change the shared tsconfig.

## Done when

Backend `typecheck`, `test` and the integration lane pass.

## Comments

- Done, uncommitted. Backend `typecheck` passes; default jest lane 38 suites / 448 tests (incl. Docker-backed `*.int.spec.ts`) and `test:int` lane 5 suites / 25 tests pass.
  - `moduleResolution: "Node"` resolves the contracts root export for types (via the package `types` field); no tsconfig change.
  - `stocks`, `market`, `disclosures` `*.types.ts` are now type re-exports from `@tuju/contracts`. Screener (`ScreenerRow`, `ScreenerProvenance`, sort/dir, sector option, `ScreenerResponse`, `ScreenerFieldsResponse`), search (`SearchResultRow`, `SearchResponse`), `ProspectusAtAGlanceResponse`, `MarketBriefResponse`, `SessionUser`, `Tier`, `MoversBoardType`, `IndexSeriesRange` also come from contracts. Kept local: screener query/filter/seam types, search seam, `IpoReferenceResponse` (worker-facing, not in contracts per ADR-0014). `ScreenerFilterField` stays a backend refinement (params narrowed to `keyof RawScreenerParams`); it is assignable to the contracts type.
  - Every read controller has an explicit contracts return type. `/ipo/:id/at-a-glance/artifact` returns `ProspectusArtifact` as a cast (`JSON.parse(...) as ProspectusArtifact`), not a runtime check; the worker validates before the S3 write.
  - Jest: `moduleNameMapper` in both configs maps `@tuju/contracts` to `packages/contracts/src/index.ts` (contracts dist is ESM, which Jest's CJS runtime cannot load) and strips `.js` from relative imports. Production code stays type-only.
  - Integration specs now run `parseOrThrow` on the JSON-round-tripped response for: stocks core/announcements/corporate-actions, search, screener, screener fields, announcements, dealings, announcement by id, both calendars, news (company + market), movers, indices, series, sectors, market brief, at-a-glance, artifact (the contracts golden fixture). New `auth.controller.spec.ts` covers `/auth/me` and `/auth/login`.
  - `intraday-replay.service.ts` `indexKey` now takes `` `${MarketIndexKind}` `` so it accepts the contracts string literal as well as the entity enum.
  - Not verified: `nest build` / the production Docker image (only `tsc --noEmit` and jest were run), and a real HTTP request against a booted app. Tests ran in a `node:24.16.0` container with the host Docker socket for testcontainers (no Node on the host).
