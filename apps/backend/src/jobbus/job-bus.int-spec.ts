/**
 * JobBus integration placeholder (ADR-0011).
 *
 * The highest-value integration seam: the JobBus enqueue → process → result path
 * (incl. failure classes / retries, ADR-0007) against REAL infra. Per ADR-0011
 * this runs against **testcontainers** (throwaway Redis + Postgres + LocalStack,
 * the same stack ADR-0006 runs in compose), wired up at ticket 06/07.
 *
 * It is a `.int-spec.ts` file, EXCLUDED from the unit lane (see jest.config.cjs
 * testPathIgnorePatterns) so the unit layer never requires live infra. The body
 * is a marked placeholder that activates when the testcontainers harness lands.
 */
describe('JobBus (integration — testcontainers, ticket 06/07)', () => {
  // eslint-disable-next-line jest/no-disabled-tests
  it.todo(
    'round-trips a stub job (enqueue → progress → result) against real Redis',
  );

  // eslint-disable-next-line jest/no-disabled-tests
  it.todo(
    'observes ADR-0007 failure classes: transient retries with backoff, terminal fails fast',
  );

  // eslint-disable-next-line jest/no-disabled-tests
  it.todo(
    'persists the S3 claim-check pointer + summary to Postgres as the sole writer (ADR-0004)',
  );
});
