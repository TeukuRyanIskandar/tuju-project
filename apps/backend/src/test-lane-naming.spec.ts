import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guard for the two Jest lanes: the unit lane matches `*.spec.ts` and the
 * integration lane matches `*.int-spec.ts`. A testcontainers spec named
 * `*.int.spec.ts` silently lands in the unit lane and never in `test:int`,
 * and a plain `*.spec.ts` that starts testcontainers needs Docker in the
 * unit lane.
 */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(join(dir, entry.name))
      : [join(dir, entry.name)],
  );
}

describe('test lane naming', () => {
  it('has no *.int.spec.ts files (use *.int-spec.ts)', () => {
    const misnamed = walk(__dirname).filter((f) => f.endsWith('.int.spec.ts'));
    expect(misnamed).toEqual([]);
  });

  it('has no unit-lane *.spec.ts importing testcontainers (use *.int-spec.ts)', () => {
    const testcontainersImport = /from ['"](?:testcontainers|@testcontainers\/[^'"]+)['"]/;
    const unitWithContainers = walk(__dirname).filter(
      (f) =>
        f.endsWith('.spec.ts') &&
        !f.endsWith('.int-spec.ts') &&
        testcontainersImport.test(readFileSync(f, 'utf8')),
    );
    expect(unitWithContainers).toEqual([]);
  });
});
