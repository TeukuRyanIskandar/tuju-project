import { z } from 'zod';
import { Period, Timeframe } from './enums.js';

/**
 * Per-job domain payloads (ADR-0007 §3).
 *
 * TA and FA payloads are INDEPENDENT — no shared base interface. They share only
 * the generic envelope (see envelope.ts). The worker is stateless (ADR-0004): the
 * payload carries anchoring context, not bulk data.
 */

// §3 Technical payload
export const TechnicalPayload = z
  .object({
    symbol: z.string().min(1), // e.g. "MAYBANK" / Bursa ticker
    timeframe: Timeframe,
    // optional hint; the resolved indicator set is AI-module content, opaque to
    // the contract (ADR-0007 §3, Out of scope).
    indicators: z.array(z.string()).optional(),
  })
  .meta({ id: 'TechnicalPayload' });
export type TechnicalPayload = z.infer<typeof TechnicalPayload>;

// §3 Fundamental payload
export const FundamentalPayload = z
  .object({
    symbol: z.string().min(1),
    period: Period,
  })
  .meta({ id: 'FundamentalPayload' });
export type FundamentalPayload = z.infer<typeof FundamentalPayload>;

// Spec-06 system-triggered showcase payloads (additive). The worker is
// stateless (ADR-0004): no anchor beyond the envelope's own `asOf` for the
// no-symbol/no-timeframe market brief, and only the announcement id for the
// announcement summary — both fetch the rest of what they need via NestJS
// read APIs rather than riding bulk content over the queue.

// Daily market brief payload: no symbol/timeframe anchor at all.
export const MarketBriefPayload = z.object({}).meta({ id: 'MarketBriefPayload' });
export type MarketBriefPayload = z.infer<typeof MarketBriefPayload>;

// Announcement-summary payload: anchoring id only.
export const AnnouncementSummaryPayload = z
  .object({
    announcementId: z.uuid(),
  })
  .meta({ id: 'AnnouncementSummaryPayload' });
export type AnnouncementSummaryPayload = z.infer<typeof AnnouncementSummaryPayload>;
