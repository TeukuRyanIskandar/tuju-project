# Frontend wiring fixes

Type: task
Status: ready-for-agent
Blocked by: 01

## Task

- Change the dev port to 5173 (`apps/frontend/package.json` `dev` script); the
  backend already uses 3000.
- Set `apps/frontend/.env.example` to `VITE_API_BASE_URL=http://localhost:3000`.
- Change `fetchSession` in `src/lib/auth.ts` to call `/auth/me` and parse the
  response with the contracts `SessionUser` schema.
- Update `src/lib/auth.test.ts`.

## Done when

Frontend `test` and `typecheck` pass, and the dev frontend gets a successful
`/health` response from the dev backend (needs ticket 04 for the browser).

## Comments
