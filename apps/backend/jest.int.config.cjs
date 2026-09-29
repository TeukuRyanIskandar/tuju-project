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
};
