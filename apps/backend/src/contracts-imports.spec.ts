import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Guard: production backend code may only `import type` from @tuju/contracts.
 *
 * The package exports ESM only (`types` + `import`), and the compiled backend is
 * CommonJS, so a value import would `require()` it and crash at boot with
 * ERR_PACKAGE_PATH_NOT_EXPORTED. Neither `tsc` (moduleResolution Node ignores
 * `exports`) nor Jest (moduleNameMapper points at the TS source) would notice.
 * Specs are exempt: they run under that mapper.
 */
const SRC = __dirname;
const VALUE_IMPORT =
  /^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+['"]@tuju\/contracts['"]|^\s*import\s+['"]@tuju\/contracts['"]|require\(\s*['"]@tuju\/contracts['"]\s*\)/m;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    const isSpec = /\.(int[.-])?spec\.ts$/.test(entry.name);
    return entry.name.endsWith('.ts') && !isSpec ? [path] : [];
  });
}

describe('@tuju/contracts imports in production code', () => {
  it('are type-only', () => {
    const offenders = sourceFiles(SRC).filter((file) => VALUE_IMPORT.test(readFileSync(file, 'utf8')));
    expect(offenders.map((file) => relative(SRC, file))).toEqual([]);
  });

  it('the guard catches a value import', () => {
    const sample = "import {\n  parseOrThrow,\n} from '@tuju/contracts';\n";
    expect(VALUE_IMPORT.test(sample)).toBe(true);
    expect(VALUE_IMPORT.test("import type { JobName } from '@tuju/contracts';")).toBe(false);
    expect(VALUE_IMPORT.test("import { Queue } from 'bullmq';\nimport type { X } from '@tuju/contracts';")).toBe(false);
  });
});
