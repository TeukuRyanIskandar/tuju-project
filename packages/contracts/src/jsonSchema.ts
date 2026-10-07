import { z } from 'zod';
// Import every schema module for side effects: each `.meta({ id })` call
// registers the schema into `z.globalRegistry`, which is what we serialize.
import './enums.js';
import './payloads.js';
import './envelope.js';
import './result.js';

/**
 * The canonical, ordered list of top-level model names emitted into both worlds.
 * Order is stable so the generated Python module and the JSON Schema are
 * deterministic (renames/reorders are wire-affecting and must be deliberate).
 *
 * NOTE: only object schemas carry `.meta({ id })` and thus land in the registry;
 * bare `z.enum(...)` values are inlined by datamodel-code-generator as Python
 * `Enum`/`Literal` types at their use sites, which is the desired output.
 */
export const modelOrder = [
  'TechnicalPayload',
  'FundamentalPayload',
  'MarketBriefPayload',
  'AnnouncementSummaryPayload',
  'ProspectusPayload',
  'TechnicalJobEnvelope',
  'FundamentalJobEnvelope',
  'MarketBriefJobEnvelope',
  'AnnouncementSummaryJobEnvelope',
  'ProspectusJobEnvelope',
  'JobProgress',
  'ArtifactPointer',
  'Summary',
  'SystemSummary',
  'JobResult',
  'JobFailure',
] as const;

/** Recursively rewrite bare `$ref: "Name"` into `$ref: "#/$defs/Name"`. */
function rewriteRefs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(rewriteRefs);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === '$ref' && typeof v === 'string' && !v.startsWith('#/')) {
        out[k] = `#/$defs/${v}`;
      } else {
        out[k] = rewriteRefs(v);
      }
    }
    return out;
  }
  return node;
}

/**
 * Build one combined JSON Schema document (draft 2020-12) whose `$defs` holds
 * every named contract model. `datamodel-code-generator` turns each `$def` into
 * a Pydantic v2 model in a single generated module.
 *
 * Uses Zod v4's native `z.toJSONSchema()` over the global registry (multi-schema
 * form), so shared sub-schemas (e.g. ArtifactPointer inside JobResult) are
 * emitted once and referenced via `$ref` — keeping the generated Python DRY.
 */
export function buildJsonSchema(): Record<string, unknown> {
  const { schemas } = z.toJSONSchema(z.globalRegistry) as unknown as {
    schemas: Record<string, Record<string, unknown>>;
  };

  const defs: Record<string, unknown> = {};
  for (const name of Object.keys(schemas).sort()) {
    // Drop the per-schema `$schema` header inside `$defs` (belongs at the root).
    const { $schema: _drop, ...rest } = schemas[name];
    defs[name] = rewriteRefs(rest);
  }

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    // No root `title` (would emit a spurious RootModel) and no root
    // `properties` (would emit a wrapper model). `datamodel-codegen` emits one
    // Pydantic class per `$defs` entry — exactly the models we want.
    $defs: defs,
  };
}
