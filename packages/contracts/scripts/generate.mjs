// @ts-check
/**
 * Contract codegen (ADR-0007 source → ADR-0008 committed artifacts).
 *
 * Pipeline:
 *   1. Build the TS package (Zod source → dist).
 *   2. Emit the combined JSON Schema (Zod v4 native z.toJSONSchema) to
 *      packages/contracts/schema/contracts.schema.json  (committed).
 *   3. Run datamodel-code-generator (via uv, using services/ai's pinned Python)
 *      → Pydantic v2 models at
 *      services/ai/src/tuju_ai/contracts_generated/models.py  (committed).
 *
 * Both outputs are committed; the `check` script regenerates and fails on any
 * git diff — the cross-language contract-drift gate (ADR-0008).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, '..');
const repoRoot = resolve(pkgRoot, '..', '..');

const SCHEMA_PATH = join(pkgRoot, 'schema', 'contracts.schema.json');
const AI_PROJECT = join(repoRoot, 'services', 'ai');
const PY_OUT_DIR = join(
  AI_PROJECT,
  'src',
  'tuju_ai',
  'contracts_generated',
);
const PY_OUT_FILE = join(PY_OUT_DIR, 'models.py');
const PY_INIT_FILE = join(PY_OUT_DIR, '__init__.py');
const PY_SCHEMA_VERSIONS_FILE = join(PY_OUT_DIR, 'schema_versions.py');

/** Run a command, inheriting stdio; throw on non-zero. */
function run(cmd, args, cwd) {
  execFileSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

// --- 1. Build the TS package so dist/jsonSchema.js is current ---------------
console.log('[generate] building TS package (tsc)...');
run('tsc', ['-p', 'tsconfig.json'], pkgRoot);

// --- 2. Emit the combined JSON Schema --------------------------------------
console.log('[generate] emitting JSON Schema...');
const { buildJsonSchema } = await import(
  pathToFileURL(join(pkgRoot, 'dist', 'jsonSchema.js')).href
);
const schema = buildJsonSchema();
mkdirSync(dirname(SCHEMA_PATH), { recursive: true });
// Trailing newline + stable 2-space indent -> deterministic diff.
writeFileSync(SCHEMA_PATH, JSON.stringify(schema, null, 2) + '\n', 'utf8');
console.log(`[generate] wrote ${SCHEMA_PATH}`);

// --- 3. Generate Pydantic v2 models via datamodel-code-generator -----------
console.log('[generate] generating Pydantic v2 models (datamodel-codegen)...');
mkdirSync(PY_OUT_DIR, { recursive: true });

run(
  'uv',
  [
    'run',
    '--project',
    AI_PROJECT,
    'datamodel-codegen',
    '--input',
    SCHEMA_PATH,
    '--input-file-type',
    'jsonschema',
    '--output',
    PY_OUT_FILE,
    '--output-model-type',
    'pydantic_v2.BaseModel',
    '--target-python-version',
    '3.12',
    '--use-standard-collections',
    '--use-union-operator',
    '--enum-field-as-literal',
    'all',
    '--disable-timestamp',
    '--formatters',
    'black',
    '--formatters',
    'isort',
  ],
  repoRoot,
);

// --- 3b. Strip the stray root RootModel stub -------------------------------
// A `$defs`-only JSON Schema makes datamodel-codegen emit a placeholder
// `class Model(RootModel[Any])` for the (empty) root. Remove it deterministically
// so `models.py` contains only real contract models. Also drop the now-unused
// `RootModel` / `Any` imports.
{
  let py = readFileSync(PY_OUT_FILE, 'utf8');
  // Normalize to LF so the committed artifact is byte-identical across OSes —
  // essential for the drift gate (CRLF vs LF would otherwise be false drift).
  py = py.replace(/\r\n/g, '\n');
  // Remove the stub class block: `class Model(RootModel[Any]):` and its body,
  // up to (but not including) the next top-level `class ` declaration.
  py = py.replace(
    /class Model\(RootModel\[Any\]\):\n {4}root: Any\n\n+class /,
    'class ',
  );
  if (/RootModel\[Any\]/.test(py)) {
    throw new Error(
      '[generate] expected to strip the RootModel stub but it is still present',
    );
  }
  // Prune unused imports left behind by the strip.
  py = py.replace('RootModel, ', '').replace(', RootModel', '');
  py = py.replace(
    'from typing import Any, Literal',
    'from typing import Literal',
  );
  py = py.replace('from typing import Any\n', '');
  if (!py.endsWith('\n')) py += '\n';
  writeFileSync(PY_OUT_FILE, py, 'utf8');
}

// --- 4. Generate schema_versions.py from TS schema-versions.ts ----------------
console.log('[generate] emitting schema_versions.py...');
{
  const schemaVersionsPath = join(pkgRoot, 'src', 'schema-versions.ts');
  let tsContent = readFileSync(schemaVersionsPath, 'utf8');
  
  // Extract the SCHEMA_VERSIONS object from TS
  const match = tsContent.match(/export const SCHEMA_VERSIONS = \{([^}]+)\} as const;/s);
  if (!match) {
    throw new Error('[generate] could not parse SCHEMA_VERSIONS from schema-versions.ts');
  }
  
  // Parse the entries
  const entries = match[1]
    .split(',')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const [key, value] = line.split(':').map(s => s.trim());
      // Remove quotes from value
      const cleanValue = value.replace(/[',]/g, '');
      return [key, cleanValue];
    });
  
  // Generate Python dict
  const pythonDictLines = entries.map(([k, v]) => `    '${k}': '${v}',`);
  const pythonCode = [
    '# GENERATED by @tuju/contracts (Batch C2). DO NOT EDIT BY HAND.',
    '# Source of truth: packages/contracts/src/schema-versions.ts',
    '# Regenerate: pnpm --filter @tuju/contracts generate',
    '',
    'SCHEMA_VERSIONS = {',
    ...pythonDictLines,
    '}',
    '',
  ].join('\n');
  
  writeFileSync(PY_SCHEMA_VERSIONS_FILE, pythonCode, 'utf8');
  console.log(`[generate] wrote ${PY_SCHEMA_VERSIONS_FILE}`);
}

// Ensure the generated dir is an importable package with a clean re-export.
writeFileSync(
  PY_INIT_FILE,
  [
    '# GENERATED by @tuju/contracts (scaffold ticket 02). DO NOT EDIT BY HAND.',
    '# Source of truth: packages/contracts (Zod v4).',
    '# Regenerate: pnpm --filter @tuju/contracts generate',
    'from .models import *  # noqa: F401,F403',
    'from .schema_versions import SCHEMA_VERSIONS  # noqa: F401',
    '',
  ].join('\n'),
  'utf8',
);
console.log(`[generate] wrote ${PY_OUT_FILE}`);
console.log('[generate] done.');
