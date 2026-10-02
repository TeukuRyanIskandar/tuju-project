import { z } from 'zod';
import { Trigger } from './enums.js';
import {
  AnnouncementSummaryPayload,
  FundamentalPayload,
  MarketBriefPayload,
  TechnicalPayload,
} from './payloads.js';

/**
 * The generic outer job envelope (ADR-0007 §3).
 *
 * Uniform routing/identity for the JobBus seam, wrapping a per-job domain
 * payload `P`. `jobId` is NOT a body field — it is the BullMQ job id set at
 * enqueue (content-derived for idempotency, ADR-0007 §2).
 */

// Envelope field shape shared by every job type (everything except `payload`).
const envelopeBase = {
  correlationId: z.uuid(), // client-facing, per request (ADR-0007 §2)
  requestedBy: z.string().min(1), // userId, or the literal 'system'
  trigger: Trigger,
  asOf: z.iso.datetime(), // ISO-8601 anchor timestamp
};

/**
 * Generic envelope factory — `JobEnvelope<P>`.
 *
 * Zod v4 has no generic-over-runtime-schema sugar, so we expose a factory that
 * builds a concrete envelope schema for a given payload schema. TS inference
 * flows through via the generic type parameter.
 */
export function JobEnvelope<P extends z.ZodTypeAny>(payload: P) {
  return z.object({
    ...envelopeBase,
    payload,
  });
}

// Convenience TS generic mirroring the ADR notation `JobEnvelope<P>`.
export type JobEnvelope<P> = {
  correlationId: string;
  requestedBy: string;
  trigger: z.infer<typeof Trigger>;
  asOf: string;
  payload: P;
};

// --- Concrete, named envelopes (these are what the codegen emits) ----------
export const TechnicalJobEnvelope = JobEnvelope(TechnicalPayload).meta({
  id: 'TechnicalJobEnvelope',
});
export type TechnicalJobEnvelope = z.infer<typeof TechnicalJobEnvelope>;

export const FundamentalJobEnvelope = JobEnvelope(FundamentalPayload).meta({
  id: 'FundamentalJobEnvelope',
});
export type FundamentalJobEnvelope = z.infer<typeof FundamentalJobEnvelope>;

// Spec-06 system-triggered showcase envelopes (additive).
export const MarketBriefJobEnvelope = JobEnvelope(MarketBriefPayload).meta({
  id: 'MarketBriefJobEnvelope',
});
export type MarketBriefJobEnvelope = z.infer<typeof MarketBriefJobEnvelope>;

export const AnnouncementSummaryJobEnvelope = JobEnvelope(
  AnnouncementSummaryPayload,
).meta({ id: 'AnnouncementSummaryJobEnvelope' });
export type AnnouncementSummaryJobEnvelope = z.infer<
  typeof AnnouncementSummaryJobEnvelope
>;
