# Backend adopts contracts types

Type: task
Status: ready-for-agent
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
