# Close-out: artifact query, local CORS verification, effort code review

Type: task
Status: done
Blocked by: 00, 01, 02, 03, 04, 05, 06, 07, 08, 09, 10 (all done)

> Access-control change (CORS config and docs). Call it out in the commit and summary.

## Task

### A. Resolve the ticket 07 follow-up

Add `prospectusArtifactQuery(prospectusId)` to `apps/frontend/src/api/ipo.ts` for
`GET /ipo/:id/at-a-glance/artifact`, validated with the contracts
`ProspectusArtifact` schema. Add a query key, remove the stale "Follow-up" comment,
and cover it in `src/api/api.test.ts` (URL, key, schema failure, and a success
parse of `packages/contracts/fixtures/prospectus-artifact.json`).

### B. CORS: resolve for local first, placeholders for production

Local (must be proven, not just unit-tested; ticket 04 never ran against a booted backend):

- Boot the real backend image (compose, own project name, no port clash with other
  local stacks) and check with `curl` and an `Origin` header:
  - allowed origin (`http://localhost:5173`, and `http://localhost:8080` from compose):
    `Access-Control-Allow-Origin` echoes the origin and
    `Access-Control-Allow-Credentials: true`, on both a simple request and an
    `OPTIONS` preflight;
  - a non-allowlisted origin: neither header.
- Check the cookie path for the credentialed flow: `POST /auth/login` from an
  allowed origin returns a `Set-Cookie` the browser can store for a
  `localhost:5173` to `localhost:3000` call (same site, so `SameSite=Lax` is fine),
  and `GET /auth/me` with that cookie returns a `SessionUser`.
- Confirm the frontend sends `credentials: 'include'` and that
  `VITE_API_BASE_URL` / the compose build arg point at `http://localhost:3000`.

Production (placeholders only; the real values are the open ADR-0005 question):

- `.env.example`, `apps/frontend/.env.example` and a comment next to `CORS_ORIGINS`
  in `docker-compose.yml` carry clearly marked, commented-out placeholders for the
  production SPA origin, `COOKIE_DOMAIN`, `COOKIE_SECURE` and `COOKIE_SAMESITE`.
  No real domain is invented. Placeholders must not be uncommented by default.
- No behavioural change for production beyond what ticket 04 already did.

### C. Code review of the whole effort (tickets 00 to 10, plus 11)

Review the commits tagged `frontend-foundation` in `git log`, by area, using
independent reviewers. Each reviewer reads the commits, not just the final tree,
and reports findings as `blocker` / `should-fix` / `nit` with `file:line`.

1. Contracts and AI (tickets 00, 01, 02): schema accuracy against the backend
   shapes, `modelOrder` leakage, strictness risks, the artifact validation in the
   worker handler, generated-file drift.
2. Backend (tickets 03, 04): contracts adoption, CORS behaviour and access-control
   correctness, the Jest source-mapping, whether any type is now a lie
   (e.g. the artifact cast), test quality.
3. Frontend (tickets 05 to 10): API layer and validation switch, auth handling,
   shared components and formatters (accessibility: colour never the only signal),
   search combobox ARIA and keyboard behaviour, `/_tokens` dev-only guarantee,
   DESIGN.md adherence (no shadows, dark only, reduced motion).
4. Cross-cutting: docs and ADR consistency (ADR-0014, CONTEXT files, DESIGN.md
   status), secrets or unpinned dependencies, leftover TODO/dead code
   (e.g. `lib/health.ts` is now unused).

All `blocker` and `should-fix` findings are fixed or explicitly deferred with a
reason recorded under Comments. Nits are listed, not required.

### D. Final gate

Run, in this order, and record the results:

- `pnpm --filter @tuju/contracts check`, `test`, `typecheck`
- `pnpm run ai:test`
- backend `typecheck`, `test`, `test:int`
- frontend `typecheck`, `test`, `build`

Only when every command passes and no `blocker` remains: set `spec.md` to
`Status: done` and move the CORS production origin to a "carried forward" note.

## Done when

- `prospectusArtifactQuery` exists and is tested.
- The local CORS checks above pass against a booted backend, with the evidence
  recorded in Comments.
- Production placeholders exist and are commented out.
- The review has run for all four areas and the findings are resolved or deferred.
- The final gate is green and `spec.md` is `done`.

## Comments

**Resolution (agent, 2026-10-08).** Access-control change: CORS/cookie docs and placeholders only. No change to production CORS behaviour.

### A. `prospectusArtifactQuery`
- `apps/frontend/src/api/ipo.ts` adds `ipoKeys.artifact(id)`, which returns `['ipo', id, 'at-a-glance', 'artifact']`. The key is nested under `atAGlance`, so invalidating the at-a-glance also drops the artifact; a comment says so.
- It also adds `prospectusArtifactQuery(id)`, which calls `GET /ipo/:id/at-a-glance/artifact` validated with `ProspectusArtifact`. The stale "Follow-up" comment is removed.
- `src/api/api.test.ts` covers the key, the encoded URL, that `{}` rejects with `ContractParseError`, and a success parse of `packages/contracts/fixtures/prospectus-artifact.json`. The fixture is imported via Vite `?raw`, so no tsconfig change was needed.

### B. CORS, local proof against the booted backend
- The real backend image was booted with `docker compose -p tuju-ff11 -f docker-compose.yml -f <scratch override> up -d --build --wait backend`. The override sets `ports: !reset []` on postgres, redis and localstack, because the host's 5432 and 8080 are used by other stacks. The backend publishes :3000 with the compose `CORS_ORIGINS` default (`http://localhost:5173,http://localhost:8080`). The stack was torn down with `down -v` afterwards.
- Evidence (curl, raw headers):

| Request | Origin | Result |
|---|---|---|
| `GET /health` | `http://localhost:5173` | 200, `Access-Control-Allow-Origin: http://localhost:5173`, `Access-Control-Allow-Credentials: true`, `Vary: Origin` |
| `GET /health` | `http://localhost:8080` | 200, ACAO `http://localhost:8080`, ACAC `true` |
| `OPTIONS /auth/me` (ACRM GET) | `:5173` / `:8080` | 204, ACAO echoes origin, ACAC `true`, `Access-Control-Allow-Methods: GET,HEAD,PUT,PATCH,POST,DELETE` |
| `OPTIONS /auth/login` (ACRM POST, ACRH content-type) | `:5173` | 204, ACAO/ACAC as above, `Access-Control-Allow-Headers: content-type` |
| `GET /health` | `http://evil.example` | 200, no ACAO and no ACAC |
| `OPTIONS /auth/me` | `http://evil.example` | 404, no ACAO and no ACAC |
| `GET /health` | none | 200, no CORS headers |
| `POST /auth/login` `{}` | `:5173` | 201, ACAO/ACAC, `Set-Cookie: tuju_session=<uuid>; Max-Age=604800; Path=/; Expires=...; HttpOnly; SameSite=Lax`. No `Secure` flag, as expected over local HTTP. `localhost:5173` to `localhost:3000` is same-site, so Lax is sent. |
| `GET /auth/me` with that cookie | `:5173` | 200, `{"userId":"stub-user","tier":"free"}`, a `SessionUser` |
| `GET /auth/me` without a cookie | `:5173` | 401 |

- Static checks:
  - `apps/frontend/src/lib/api.ts` `apiFetch` sends `credentials: 'include'`.
  - `apps/frontend/.env.example` sets `VITE_API_BASE_URL=http://localhost:3000`.
  - `apps/frontend/Dockerfile` has `ARG VITE_API_BASE_URL=http://localhost:3000`. The compose `frontend` service passes no override, so the ARG default applies.
- Production placeholders are all commented out and use no real domain:
  - `.env.example`: `CORS_ORIGINS=https://<production-spa-origin>`, `COOKIE_DOMAIN=<.shared-parent-domain>`, `COOKIE_SECURE=true`, `COOKIE_SAMESITE=lax`.
  - `apps/frontend/.env.example`: `VITE_API_BASE_URL=https://<production-api-origin>`.
  - `docker-compose.yml`: a comment next to `CORS_ORIGINS` pointing at them.

### C. Review (four independent reviewers, reading the commits)
No `blocker` in any area.

**Contracts + AI (00, 01, 02).** No should-fix. Nits, not done:
- `test_artifact_with_unknown_key_is_rejected_before_write` should also assert that no S3 object exists.
- The generated Pydantic models are lax (no `strict=True`), so they are looser than Zod.
- `board` is `z.string()` where `ListingBoard` would be tighter (`http/ipo.ts:13`, `http/search.ts:10`).
- A strict artifact plus a terminal failure costs the full LLM spend on drift. Do one real-model and Docling run before relying on it.

**Backend (03, 04).** CORS access control was confirmed correct: exact allowlist, credentials only for allowed origins, and no headers for a disallowed or missing Origin.
- should-fix, **fixed**: the Jest `moduleNameMapper` hides the fact that a value import of `@tuju/contracts` crashes the CJS backend at boot (`ERR_PACKAGE_PATH_NOT_EXPORTED`; the package exports ESM only). Added `apps/backend/src/contracts-imports.spec.ts`, which fails on any non-`import type` / `require` of the package outside specs. It runs in the default `test` lane and all current imports pass.
- should-fix, **deferred**: `ipo.service.ts:88` `JSON.parse(body) as ProspectusArtifact` is an unchecked cast. Reasons for deferring:
  - A backend runtime parse needs a CJS (`require`) export of `@tuju/contracts`, which is a packaging change outside this effort.
  - Meanwhile the worker validates before the S3 write (ticket 02), and the frontend now parses it with `ProspectusArtifact` in dev and test.
  - The remaining gap is objects written before the schema existed, plus production, where the frontend skips validation.
  - Carried forward in `spec.md`.
- Nits, not done:
  - Disallowed and no-Origin responses carry no `Vary: Origin` (this fails closed).
  - `CORS_ORIGINS` entries are not checked to be real origins (`new URL(o).origin === o`).
  - The Jest `.js` rewrite applies more broadly than intended.
  - `GET /analysis/:correlationId` has no contract type.
  - Weak assertions in the `auth.controller.spec` login test, in `stocks.int.spec` (it parses the service, not the controller), and in the disallowed-preflight status check.

**Frontend (05 to 10, plus A).**
- `ChangeChip` gives the direction by more than colour.
- The combobox ARIA and keyboard behaviour, dark-only, no-shadow and reduced-motion rules all hold.
- `/_tokens` is confirmed absent from the production build: the split component is `void 0`, nothing from `src/dev/*` is emitted, and it returns `notFound()` outside dev.
- should-fix, **fixed**: `search-box.tsx` kept `activeIndex` across a new result set. It could point past the end of a shorter list, and Enter then fell back to `items[0]`. It now resets on every new `query.data`. A regression test was added; it fails without the fix.
- should-fix, **fixed**: `lib/api.ts` `apiGet` used `res.json()`, so a non-JSON 2xx (for example an SPA fallback page) threw a bare `SyntaxError`, which was retried. It now throws `ContractParseError` ("body is not JSON"), which is not retried. A test was added.
- Nits, not done:
  - Production returns raw JSON typed as the schema output, which is only sound while no contract uses transforms or defaults.
  - The fixture path crosses workspaces.
  - 403 on `/auth/me` is treated as anonymous.
  - Enter is ignored while results are stale.
  - No `aria-keyshortcuts="/"`.
  - `LoadingState` `animate-spin` versus DESIGN.md principle 8; it is frozen under reduced motion.
  - A live region sits inside a `hidden` container.
- Nits **done** (my own code): the artifact test asserts `ContractParseError`, and the key nesting is commented.

**Cross-cutting.** No secrets (only local fakes). The ADR range is consistent. DESIGN.md status matches the code.
- should-fix, **fixed**: deleted the dead `apps/frontend/src/lib/health.ts` (no importers since ticket 09).
- should-fix, **fixed**: `services/ai/CONTEXT.md` Runtime conformance now covers the pre-write `ProspectusArtifact` validation and cites ADR-0014.
- should-fix, **fixed**: `apps/frontend/CONTEXT.md` now says the frontend imports contracts runtime values (Zod schemas, `parseOrThrow`) and cites ADR-0014.
- Nits, not done:
  - ADR-0014 §5 says "drops" the backend `*.types.ts` files, but they were kept as type-only re-exports.
  - ADR-0014 still points at production validation as an open question, but ticket 07 decided it.
  - An orphaned `SessionUser` doc block in `session.types.ts`.
  - `apps/backend/CONTEXT.md` doesn't mention CORS.
  - The `packages/contracts/CONTEXT.md` glossary lacks the HTTP schemas and `ProspectusArtifact`.
  - Tickets 03, 05 and 10 still say "Done, uncommitted".
  - The version-pin convention is split between older `^` ranges and the new exact pins.

### D. Final gate (host, Node 24.16.0 via nvm; in this order, all green)
| Command | Result |
|---|---|
| `pnpm --filter @tuju/contracts check` | pass (no generated drift) |
| `pnpm --filter @tuju/contracts test` | pass, 50 tests |
| `pnpm --filter @tuju/contracts typecheck` | pass |
| `pnpm run ai:test` | pass, 115 passed, 1 skipped |
| backend `typecheck` | pass |
| backend `test` | pass, 39 suites, 450 tests |
| backend `test:int` | pass, 5 suites, 25 tests (testcontainers) |
| frontend `typecheck` | pass |
| frontend `test` | pass, 13 files, 199 tests |
| frontend `build` | pass |

No blockers remain, so `spec.md` is set to `done` and the production CORS origin is carried forward.
