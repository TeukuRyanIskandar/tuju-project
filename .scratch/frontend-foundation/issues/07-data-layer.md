# Data layer: TanStack Query and typed API client

Type: task
Status: ready-for-agent
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
