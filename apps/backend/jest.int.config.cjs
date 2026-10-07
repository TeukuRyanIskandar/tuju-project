/**
 * Jest config for the backend INTEGRATION lane (ADR-0011).
 *
 * Mirror of jest.config.cjs but inverted: it runs ONLY the *.int-spec.ts files
 * (the testcontainers seams — real Redis + Postgres), which the unit config
 * (jest.config.cjs) deliberately excludes. Docker is required; this config is
 * invoked only in the CI integration lane (ci-integration.yml), never in the
 * fast PR unit lane.
 */
/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.int-spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }],
  },
  testEnvironment: 'node',
  // `@tuju/contracts` ships ESM (dist), which Jest's CommonJS runtime cannot load.
  // Specs that parse responses with its Zod schemas resolve it to the TS source
  // instead, transpiled by ts-jest; `.js` suffixes on its relative imports are
  // stripped so they resolve to the `.ts` files. Production code stays type-only.
  moduleNameMapper: {
    '^@tuju/contracts$': '<rootDir>/../../../packages/contracts/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
