# Golden contract fixtures

Canonical, hand-authored instances of the ADR-0007 wire contract. These files are
the **single set of runtime-conformance fixtures (ADR-0011)** loaded by BOTH test
suites:

- **TS** — `packages/contracts/test/fixtures.test.ts` parses each against the Zod
  schema.
- **Python** — `services/ai/tests/test_contracts_conformance.py` parses each against
  the generated Pydantic v2 model.

Cross-language agreement on these exact bytes is the guarantee the contract seam
exists to provide. When you change a schema, update the fixture(s) here and both
suites in lock-step.

| Fixture                          | Model                    |
| -------------------------------- | ------------------------ |
| `technical-job-envelope.json`    | `TechnicalJobEnvelope`   |
| `fundamental-job-envelope.json`  | `FundamentalJobEnvelope` |
| `job-progress.json`              | `JobProgress`            |
| `job-result.json`                | `JobResult` (verdict-bearing `Summary`) |
| `job-result-system.json`         | `JobResult` (verdict-less `SystemSummary`) |
| `job-failure.json`               | `JobFailure`             |
