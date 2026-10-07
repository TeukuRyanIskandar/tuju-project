/**
 * Jest config for @tuju/backend (ADR-0011: Jest on its home turf for NestJS).
 *
 * The unit layer runs with NO Docker and NO live Redis/Postgres — dependencies
 * are mocked (stub JobBus, fake sessions). Integration specs (*.int-spec.ts)
 * are excluded here and activated against testcontainers at ticket 06/07.
 */
/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }],
  },
  collectCoverageFrom: ['**/*.ts', '!**/*.module.ts', '!main.ts'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  // `@tuju/contracts` ships ESM (dist), which Jest's CommonJS runtime cannot load.
  // Specs that parse responses with its Zod schemas resolve it to the TS source
  // instead, transpiled by ts-jest; `.js` suffixes on its relative imports are
  // stripped so they resolve to the `.ts` files. Production code stays type-only.
  moduleNameMapper: {
    '^@tuju/contracts$': '<rootDir>/../../../packages/contracts/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // Integration placeholders run against testcontainers later (ADR-0011); the
  // unit lane must never require live infra, so they are excluded here.
  testPathIgnorePatterns: ['\\.int-spec\\.ts$'],
};
