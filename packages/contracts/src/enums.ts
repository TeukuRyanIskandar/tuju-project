import { z } from 'zod';

/**
 * Fixed enums for the cross-language wire contract (ADR-0007 §1, §4, §5, §6).
 *
 * These enums are CONTRACT-OWNED. ADR-0007 delegates the concrete pinning of the
 * `phase` and `Verdict` enum values to implementation time ("named but not
 * enumerated" until pinned). Extending any enum is ADDITIVE — never remove or
 * renumber a member, only append.
 */

// --- §1 Job names (queue `analysis`) ---------------------------------------
// Two independent v1 job types, plus the spec-06 system-triggered showcase
// jobs (additive, free-tier-ai-showcase ticket 01 decision): each shallow
// artifact (daily market brief, announcement summaries) gets its own job name
// rather than NestJS calling an LLM directly, following the same JobBus/
// claim-check pattern as TA/FA.
export const JobName = z.enum([
  'analyze-technical',
  'analyze-fundamental',
  'generate-market-brief',
  'summarize-announcement',
]);
export type JobName = z.infer<typeof JobName>;

// --- Envelope trigger (ADR-0003: both triggers ride the same queue) --------
// 'system' is a new trusted-internal-caller path, additive alongside the
// existing 'price-move' one ADR-0005 names as bypassing tier gating — it
// extends that same bypass posture to the new system-triggered artifacts
// (daily market brief, announcement summaries, prospectus at-a-glance).
export const Trigger = z.enum(['user', 'price-move', 'system']);
export type Trigger = z.infer<typeof Trigger>;

// --- §3 Technical payload domain enum --------------------------------------
export const Timeframe = z.enum(['1D', '1W', '1M']); // v1 set; extend additively
export type Timeframe = z.infer<typeof Timeframe>;

// --- §3 Fundamental payload domain enum ------------------------------------
export const Period = z.enum(['annual', 'quarterly']);
export type Period = z.infer<typeof Period>;

// --- §4 Progress phase enums, FIXED PER JOB TYPE ---------------------------
// Python must emit known phases; the FE localizes them. Free-form phase strings
// were rejected (ADR-0007 §4). Pinned here from the v1 LangGraph graph shape.
export const TechnicalPhase = z.enum([
  'queued',
  'fetching-market-data',
  'computing-indicators',
  'synthesizing-verdict',
  'persisting-artifact',
  'done',
]);
export type TechnicalPhase = z.infer<typeof TechnicalPhase>;

export const FundamentalPhase = z.enum([
  'queued',
  'fetching-financials',
  'computing-metrics',
  'synthesizing-verdict',
  'persisting-artifact',
  'done',
]);
export type FundamentalPhase = z.infer<typeof FundamentalPhase>;

// Phases for the spec-06 system-triggered showcase jobs (additive).
export const MarketBriefPhase = z.enum([
  'queued',
  'fetching-market-data',
  'drafting-narrative',
  'persisting-artifact',
  'done',
]);
export type MarketBriefPhase = z.infer<typeof MarketBriefPhase>;

export const AnnouncementSummaryPhase = z.enum([
  'queued',
  'fetching-announcement',
  'summarizing',
  'persisting-artifact',
  'done',
]);
export type AnnouncementSummaryPhase = z.infer<typeof AnnouncementSummaryPhase>;

// Union of all phases — used by the generic JobProgress envelope so a single
// progress shape carries any job type's phase.
export const Phase = z.enum([
  ...TechnicalPhase.options,
  ...FundamentalPhase.options,
  ...MarketBriefPhase.options,
  ...AnnouncementSummaryPhase.options,
]);
export type Phase = z.infer<typeof Phase>;

// --- §5 Verdict enums ------------------------------------------------------
// Thin, stable summary verdicts (Option A). Fixed per job family.
export const TechnicalVerdict = z.enum(['bullish', 'bearish', 'neutral']);
export type TechnicalVerdict = z.infer<typeof TechnicalVerdict>;

export const FundamentalVerdict = z.enum([
  'undervalued',
  'fairly-valued',
  'overvalued',
]);
export type FundamentalVerdict = z.infer<typeof FundamentalVerdict>;

// Union verdict for the generic Summary shape.
export const Verdict = z.enum([
  ...TechnicalVerdict.options,
  ...FundamentalVerdict.options,
]);
export type Verdict = z.infer<typeof Verdict>;

// --- §6 Failure class ------------------------------------------------------
export const FailureClass = z.enum(['transient_exhausted', 'terminal']);
export type FailureClass = z.infer<typeof FailureClass>;
