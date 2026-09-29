// @ts-check
/**
 * Contract-drift gate (ADR-0008).
 *
 * Regenerates every committed artifact from the Zod source, then fails if the
 * working tree differs from HEAD for any generated path. A failing diff is the
 * reviewable, teaching signal ADR-0008 chose over build-time-only generation.
 *
 * Wired into CI at ticket 07 (PR lane). Passes on a clean tree; fails after any
 * hand-edit of a generated file or any un-regenerated Zod source change.
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, '..');
const repoRoot = resolve(pkgRoot, '..', '..');

// Paths (repo-relative) that `generate` owns and commits.
const GENERATED_PATHS = [
  'packages/contracts/schema/contracts.schema.json',
  'services/ai/src/tuju_ai/contracts_generated',
];

console.log('[check] regenerating contract artifacts...');
execFileSync('node', ['scripts/generate.mjs'], {
  cwd: pkgRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

console.log('[check] diffing generated artifacts against HEAD...');
const status = execFileSync(
  'git',
  ['status', '--porcelain', '--', ...GENERATED_PATHS],
  { cwd: repoRoot, encoding: 'utf8' },
);

if (status.trim().length > 0) {
  console.error(
    '\n[check] FAILED — contract drift detected.\n' +
      'Generated artifacts differ from the committed source. Run\n' +
      '  pnpm --filter @tuju/contracts generate\n' +
      'and commit the result. Offending paths:\n',
  );
  console.error(status);
  // Show the actual diff to make the signal actionable.
  try {
    execFileSync('git', ['--no-pager', 'diff', '--', ...GENERATED_PATHS], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
  } catch {
    /* diff is best-effort; the porcelain status above is authoritative */
  }
  process.exit(1);
}

console.log('[check] OK — no contract drift.');
