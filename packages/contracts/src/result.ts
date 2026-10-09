import { z } from 'zod';
import { FailureClass, Phase, Verdict } from './enums.js';

/**
 * Progress, result/summary, and failure schemas (ADR-0007 §4, §5, §6).
 */

// --- §4 Progress — step-based, no percent ----------------------------------
export const JobProgress = z
  .object({
    stepIndex: z.number().int().min(0), // 0-based
    stepTotal: z.number().int().min(0).nullable(), // null when unknown ahead
    phase: Phase, // fixed enum (per job type; union at the wire)
    label: z.string(), // human-readable, worker-provided (may be non-localized)
    at: z.iso.datetime(), // ISO-8601
  })
  .meta({ id: 'JobProgress' });
export type JobProgress = z.infer<typeof JobProgress>;

// --- §5 Result — claim-check pointer + thin summary -------------------------
export const ArtifactPointer = z
  .object({
    bucket: z.string().min(1),
    key: z.string().min(1),
    sha256: z.string().min(1),
    bytes: z.number().int().min(0),
    contentType: z.string().min(1), // e.g. "application/json"
  })
  .meta({ id: 'ArtifactPointer' });
export type ArtifactPointer = z.infer<typeof ArtifactPointer>;

// Thin, stable summary (Option A): enough for a first-glance render without an
// S3 round-trip. Rich detail lives in the (opaque) S3 artifact.
//
// `.strict()` (rejects unknown keys at runtime, matching the JSON Schema's
// `additionalProperties: false`) is required so `JobResult.summary`'s union
// below disambiguates correctly — without it, a verdict-bearing payload with
// a malformed `verdict` would silently strip to a (wrongly) valid SystemSummary.
export const Summary = z
  .strictObject({
    verdict: Verdict,
    headline: z.string(),
    asOf: z.iso.datetime(),
  })
  .meta({ id: 'Summary' });
export type Summary = z.infer<typeof Summary>;

// Verdict-less summary variant for system-triggered artifacts with no
// bullish/bearish/over/under-valued verdict (prospectus at-a-glance, daily
// market brief, announcement summaries, and PoC Phase A TA/FA). `Summary`
// remains for a future paid verdict-bearing path.
export const SystemSummary = z
  .strictObject({
    headline: z.string(),
    asOf: z.iso.datetime(),
  })
  .meta({ id: 'SystemSummary' });
export type SystemSummary = z.infer<typeof SystemSummary>;

// §5 / §7 — the worker's `job.returnvalue`.
export const JobResult = z
  .object({
    correlationId: z.uuid(),
    jobId: z.string().min(1),
    pointer: ArtifactPointer,
    summary: z.union([Summary, SystemSummary]),
    at: z.iso.datetime(), // ISO-8601
  })
  .meta({ id: 'JobResult' });
export type JobResult = z.infer<typeof JobResult>;

// --- §6 Failure — UI-facing failure event -----------------------------------
export const JobFailure = z
  .object({
    correlationId: z.uuid(),
    jobId: z.string().min(1),
    failureClass: FailureClass,
    retryable: z.boolean(), // true => UI may offer a "try again" button
    userMessage: z.string(), // safe, human-readable; never a raw stack trace
    at: z.iso.datetime(),
  })
  .meta({ id: 'JobFailure' });
export type JobFailure = z.infer<typeof JobFailure>;
