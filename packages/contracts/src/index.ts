/**
 * @tuju/contracts — the single cross-language contract seam (ADR-0002, ADR-0007).
 * ADR-0013 is the additive amendment to ADR-0007 (`trigger: 'system'`, verdict-less
 * `SystemSummary`, the spec-06 job names).
 *
 * Zod v4 is the source of truth. TS types are exported natively (inferred from
 * the Zod schemas). Python Pydantic v2 models are generated from the JSON Schema
 * this package emits (see scripts/generate.mjs, ADR-0008) into
 * `services/ai/src/tuju_ai/contracts_generated/`.
 *
 * Never import across languages — the two worlds communicate only through the
 * JobBus (ADR-0001) and this generated contract.
 */

export * from './enums.js';
export * from './payloads.js';
export * from './envelope.js';
export * from './result.js';
export * from './artifact.js';
export * from './schema-versions.js';
export * from './job-registry.js';
export { buildJsonSchema, modelOrder } from './jsonSchema.js';
export * from './http/index.js';
