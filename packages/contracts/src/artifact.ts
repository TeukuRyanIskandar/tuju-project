import { z } from 'zod';
import { SCHEMA_VERSIONS } from './schema-versions.js';

/**
 * Prospectus at-a-glance artifact (ADR-0014 §3) — the document the worker writes
 * to S3 and NestJS proxies to the browser at
 * `GET /ipo/:prospectusId/at-a-glance/artifact`.
 *
 * Mirrors the dict assembled by `analyze_prospectus`
 * (services/ai/src/tuju_ai/prospectus/analysis.py) plus the `parse` block the
 * handler adds just before the S3 write. The worker validates the assembled dict
 * against the generated Pydantic model of this schema before writing.
 *
 * Conventions:
 * - The producer always dumps every field (`model_dump(mode="json")`), so a
 *   value that may be missing is required-but-nullable, never optional.
 * - Objects are strict: an unknown key is a producer/consumer drift and must
 *   fail loudly (see also `Summary` in result.ts).
 * - LLM free text that is not a closed set (`sourceSection`, the cost `step`)
 *   stays a plain string so model drift cannot fail a job.
 * - The producer stamps `generatedAt` with `datetime.isoformat()` on a UTC
 *   datetime, i.e. `+00:00` rather than `Z`, hence `offset: true`.
 */

const Count = z.number().int().min(0);
const NullableText = z.string().nullable();

// --- provenance / company ---------------------------------------------------
export const ProspectusProvenance = z
  .strictObject({
    source: z.literal('real'), // the one showcase artifact, on real licence-safe data
    pdfSha256: z.string().min(1),
    model: z.string().min(1),
    generatedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'ProspectusProvenance' });
export type ProspectusProvenance = z.infer<typeof ProspectusProvenance>;

export const ProspectusCompany = z
  .strictObject({
    name: z.string().min(1),
    board: NullableText,
    listingDate: NullableText, // free string as held on the IPO reference row
  })
  .meta({ id: 'ProspectusCompany' });
export type ProspectusCompany = z.infer<typeof ProspectusCompany>;

// --- routing (how the section's source text was chosen) ---------------------
export const ProspectusRouting = z
  .strictObject({
    source: z.enum(['located', 'fallback']),
    located: z.boolean(),
    matchedHeadings: z.array(z.string()),
    routedChars: Count,
    inputChars: Count,
    truncated: z.boolean(),
  })
  .meta({ id: 'ProspectusRouting' });
export type ProspectusRouting = z.infer<typeof ProspectusRouting>;

// --- section data (dumped from the lenient analysis_models.py outputs) ------
export const ProspectusUseOfProceedsItem = z
  .strictObject({
    purpose: z.string(),
    amount: NullableText,
    percentOfProceeds: NullableText,
  })
  .meta({ id: 'ProspectusUseOfProceedsItem' });
export type ProspectusUseOfProceedsItem = z.infer<typeof ProspectusUseOfProceedsItem>;

export const ProspectusOfferData = z
  .strictObject({
    summary: NullableText,
    totalShares: NullableText,
    publicIssueShares: NullableText,
    offerForSaleShares: NullableText,
    priceRange: NullableText,
    marketCapAtIpo: NullableText,
    grossProceeds: NullableText,
    useOfProceeds: z.array(ProspectusUseOfProceedsItem),
  })
  .meta({ id: 'ProspectusOfferData' });
export type ProspectusOfferData = z.infer<typeof ProspectusOfferData>;

export const ProspectusBusinessData = z
  .strictObject({
    lines: z.array(z.string()).min(1), // the business in (up to) three lines
  })
  .meta({ id: 'ProspectusBusinessData' });
export type ProspectusBusinessData = z.infer<typeof ProspectusBusinessData>;

export const ProspectusFinancialPeriod = z
  .strictObject({
    period: z.string(),
    revenue: NullableText,
    grossProfit: NullableText,
    profitAfterTax: NullableText,
    netMargin: NullableText,
  })
  .meta({ id: 'ProspectusFinancialPeriod' });
export type ProspectusFinancialPeriod = z.infer<typeof ProspectusFinancialPeriod>;

export const ProspectusFinancialsData = z
  .strictObject({
    currency: NullableText,
    periods: z.array(ProspectusFinancialPeriod),
    trend: z.string().min(1),
    highlights: z.array(z.string()),
  })
  .meta({ id: 'ProspectusFinancialsData' });
export type ProspectusFinancialsData = z.infer<typeof ProspectusFinancialsData>;

export const ProspectusRiskSeverity = z.enum(['low', 'medium', 'high']);
export type ProspectusRiskSeverity = z.infer<typeof ProspectusRiskSeverity>;

export const ProspectusRiskTheme = z
  .strictObject({
    rank: z.number().int(),
    theme: z.string(),
    severity: ProspectusRiskSeverity,
    summary: NullableText,
  })
  .meta({ id: 'ProspectusRiskTheme' });
export type ProspectusRiskTheme = z.infer<typeof ProspectusRiskTheme>;

export const ProspectusRiskData = z
   .strictObject({
     summary: NullableText,
     themes: z.array(ProspectusRiskTheme).min(0), // ordered by rank
   })
   .meta({ id: 'ProspectusRiskData' });
export type ProspectusRiskData = z.infer<typeof ProspectusRiskData>;

export const ProspectusWatchItem = z
  .strictObject({
    point: z.string(),
    why: NullableText,
    sourceSection: NullableText, // LLM free text: deliberately not an enum
  })
  .meta({ id: 'ProspectusWatchItem' });
export type ProspectusWatchItem = z.infer<typeof ProspectusWatchItem>;

export const ProspectusWatchData = z
  .strictObject({
    headline: z.string().min(1),
    items: z.array(ProspectusWatchItem).min(1),
  })
  .meta({ id: 'ProspectusWatchData' });
export type ProspectusWatchData = z.infer<typeof ProspectusWatchData>;

// --- sections ---------------------------------------------------------------
export const ProspectusOfferSection = z
  .strictObject({ routing: ProspectusRouting, data: ProspectusOfferData })
  .meta({ id: 'ProspectusOfferSection' });
export const ProspectusBusinessSection = z
  .strictObject({ routing: ProspectusRouting, data: ProspectusBusinessData })
  .meta({ id: 'ProspectusBusinessSection' });
export const ProspectusFinancialsSection = z
  .strictObject({ routing: ProspectusRouting, data: ProspectusFinancialsData })
  .meta({ id: 'ProspectusFinancialsSection' });
export const ProspectusRiskSection = z
  .strictObject({ routing: ProspectusRouting, data: ProspectusRiskData })
  .meta({ id: 'ProspectusRiskSection' });
// what-to-watch is a reduce over the other four structured outputs, not over
// the document, so it has no routing; `derivedFrom` says what it was built from.
export const ProspectusWatchSection = z
  .strictObject({
    derivedFrom: z.tuple([
      z.literal('offer'),
      z.literal('business'),
      z.literal('financials'),
      z.literal('riskFactors'),
    ]),
    data: ProspectusWatchData,
  })
  .meta({ id: 'ProspectusWatchSection' });

export const ProspectusSections = z
  .strictObject({
    offer: ProspectusOfferSection,
    business: ProspectusBusinessSection,
    financials: ProspectusFinancialsSection,
    riskFactors: ProspectusRiskSection,
    whatToWatch: ProspectusWatchSection,
  })
  .meta({ id: 'ProspectusSections' });
export type ProspectusSections = z.infer<typeof ProspectusSections>;

// --- insights ---------------------------------------------------------------
export const ProspectusShariahInsight = z
  .strictObject({
    status: z.enum(['compliant', 'non-compliant', 'unknown']),
    source: z.enum(['sc-shariah-list', 'unavailable']),
    note: NullableText,
  })
  .meta({ id: 'ProspectusShariahInsight' });
export type ProspectusShariahInsight = z.infer<typeof ProspectusShariahInsight>;

export const ProspectusCornerstoneInvestor = z
  .strictObject({
    name: z.string(),
    allocation: NullableText,
    notes: NullableText,
  })
  .meta({ id: 'ProspectusCornerstoneInvestor' });
export type ProspectusCornerstoneInvestor = z.infer<typeof ProspectusCornerstoneInvestor>;

export const ProspectusCornerstoneInsight = z
  .strictObject({
    present: z.boolean(),
    investors: z.array(ProspectusCornerstoneInvestor),
    summary: NullableText,
    inputChars: Count,
    truncated: z.boolean(),
    llmCalled: z.boolean(), // false when no cornerstone text was found (no LLM spend)
  })
  .meta({ id: 'ProspectusCornerstoneInsight' });
export type ProspectusCornerstoneInsight = z.infer<typeof ProspectusCornerstoneInsight>;

export const ProspectusLockupEntry = z
  .strictObject({
    name: z.string(),
    shares: NullableText,
    duration: NullableText,
    notes: NullableText,
  })
  .meta({ id: 'ProspectusLockupEntry' });
export type ProspectusLockupEntry = z.infer<typeof ProspectusLockupEntry>;

// Moratorium on promoters'/specified shareholders' shares (prospectus-v2 T05).
export const ProspectusLockupInsight = z
  .strictObject({
    present: z.boolean(),
    entries: z.array(ProspectusLockupEntry),
    summary: NullableText,
    routing: ProspectusRouting,
  })
  .meta({ id: 'ProspectusLockupInsight' });
export type ProspectusLockupInsight = z.infer<typeof ProspectusLockupInsight>;

export const ProspectusRelatedPartyItem = z
  .strictObject({
    counterparty: z.string(),
    nature: NullableText,
    amount: NullableText,
    basis: NullableText,
  })
  .meta({ id: 'ProspectusRelatedPartyItem' });
export type ProspectusRelatedPartyItem = z.infer<typeof ProspectusRelatedPartyItem>;

// Material related-party transactions (prospectus-v2 T05).
export const ProspectusRelatedPartyInsight = z
  .strictObject({
    present: z.boolean(),
    items: z.array(ProspectusRelatedPartyItem),
    aggregateAmount: NullableText,
    summary: NullableText,
    routing: ProspectusRouting,
  })
  .meta({ id: 'ProspectusRelatedPartyInsight' });
export type ProspectusRelatedPartyInsight = z.infer<typeof ProspectusRelatedPartyInsight>;

export const ProspectusInsights = z
  .strictObject({
    shariah: ProspectusShariahInsight,
    cornerstone: ProspectusCornerstoneInsight,
    // Optional: artifacts written before prospectus-v2 T05 lack them.
    lockup: ProspectusLockupInsight.optional(),
    relatedParty: ProspectusRelatedPartyInsight.optional(),
  })
  .meta({ id: 'ProspectusInsights' });
export type ProspectusInsights = z.infer<typeof ProspectusInsights>;

// --- cost (CostTracker.report(), services/ai/src/tuju_ai/llm/cost.py) --------
export const ProspectusCostCall = z
  .strictObject({
    step: z.string(), // analysis step id; plain string so a new step cannot fail a job
    promptTokens: Count,
    completionTokens: Count,
    cachedTokens: Count,
    costUsd: z.number().min(0),
    // The model that actually answered (OpenRouter's response `model`). With a
    // router id like `openrouter/free` it can differ per call (prospectus-v2 T04).
    model: z.string().min(1).optional(),
  })
  .meta({ id: 'ProspectusCostCall' });
export type ProspectusCostCall = z.infer<typeof ProspectusCostCall>;

export const ProspectusCostReport = z
  .strictObject({
    model: z.string().min(1),
    calls: Count,
    promptTokens: Count,
    completionTokens: Count,
    cachedTokens: Count,
    estimatedCostUsd: z.number().min(0),
    ceilingUsd: z.number().min(0),
    perCall: z.array(ProspectusCostCall),
  })
  .meta({ id: 'ProspectusCostReport' });
export type ProspectusCostReport = z.infer<typeof ProspectusCostReport>;

// --- parse (added by the handler before the S3 write) ------------------------
export const ProspectusParseInfo = z
  .strictObject({
    parsedNow: z.boolean(),
    reusedParse: z.boolean(),
  })
  .meta({ id: 'ProspectusParseInfo' });
export type ProspectusParseInfo = z.infer<typeof ProspectusParseInfo>;

// Wall-clock phase timings (prospectus-v2 T06). parseMs covers fetching the
// persisted parse or parsing afresh, plus routing; analysisMs the LLM calls.
export const ProspectusTiming = z
  .strictObject({
    parseMs: Count,
    analysisMs: Count,
  })
  .meta({ id: 'ProspectusTiming' });
export type ProspectusTiming = z.infer<typeof ProspectusTiming>;

// --- the artifact -----------------------------------------------------------
export const ProspectusArtifact = z
   .strictObject({
     schemaVersion: z.literal(SCHEMA_VERSIONS.prospectus),
     prospectusId: z.string().min(1),
    provenance: ProspectusProvenance,
    company: ProspectusCompany,
    headline: z.string().min(1), // == sections.whatToWatch.data.headline
    sections: ProspectusSections,
    insights: ProspectusInsights,
    cost: ProspectusCostReport,
    parse: ProspectusParseInfo,
    timing: ProspectusTiming.optional(), // absent on pre-prospectus-v2 artifacts
  })
  .meta({ id: 'ProspectusArtifact' });
export type ProspectusArtifact = z.infer<typeof ProspectusArtifact>;

// --- PoC Phase A TA/FA analysis artifacts ------------------------------------
// Shared envelopes + registered rich S3 JSON for system-precomputed
// analyze-technical / analyze-fundamental (`.scratch/poc-phase-a-contracts`).
// Cost reuses ProspectusCostReport; Nest strips cost on HTTP proxy (ADR-0014).

const NullableNumber = z.number().nullable();

export const AnalysisNarrative = z
  .strictObject({
    language: z.enum(['en', 'ms']),
    text: z.string().min(1),
  })
  .meta({ id: 'AnalysisNarrative' });
export type AnalysisNarrative = z.infer<typeof AnalysisNarrative>;

export const AnalysisProvenance = z
  .strictObject({
    source: z.literal('real'),
    adapter: z.literal('yfinance'),
    model: z.string().min(1),
    generatedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'AnalysisProvenance' });
export type AnalysisProvenance = z.infer<typeof AnalysisProvenance>;

export const TechnicalSmaFacts = z
  .strictObject({
    p20: NullableNumber,
    p50: NullableNumber,
    p200: NullableNumber,
  })
  .meta({ id: 'TechnicalSmaFacts' });
export type TechnicalSmaFacts = z.infer<typeof TechnicalSmaFacts>;

export const TechnicalRsiFacts = z
  .strictObject({
    period: z.literal(14),
    value: NullableNumber,
  })
  .meta({ id: 'TechnicalRsiFacts' });
export type TechnicalRsiFacts = z.infer<typeof TechnicalRsiFacts>;

export const TechnicalMacdFacts = z
  .strictObject({
    line: NullableNumber,
    signal: NullableNumber,
    histogram: NullableNumber,
  })
  .meta({ id: 'TechnicalMacdFacts' });
export type TechnicalMacdFacts = z.infer<typeof TechnicalMacdFacts>;

export const TechnicalWeek52Facts = z
  .strictObject({
    high: NullableNumber,
    low: NullableNumber,
  })
  .meta({ id: 'TechnicalWeek52Facts' });
export type TechnicalWeek52Facts = z.infer<typeof TechnicalWeek52Facts>;

export const TechnicalFacts = z
  .strictObject({
    sma: TechnicalSmaFacts,
    rsi: TechnicalRsiFacts,
    macd: TechnicalMacdFacts,
    week52: TechnicalWeek52Facts,
  })
  .meta({ id: 'TechnicalFacts' });
export type TechnicalFacts = z.infer<typeof TechnicalFacts>;

export const TechnicalEventId = z.enum([
  'ma_cross_20_50',
  'ma_cross_50_200',
  'price_vs_sma',
  'rsi_band',
  'macd_cross',
  'week52_proximity',
  'broke_swing_high',
]);
export type TechnicalEventId = z.infer<typeof TechnicalEventId>;

export const TechnicalEventValue = z.union([
  z.number(),
  z.string(),
  z.boolean(),
  z.null(),
]);
export type TechnicalEventValue = z.infer<typeof TechnicalEventValue>;

export const TechnicalEvent = z
  .strictObject({
    id: TechnicalEventId,
    label: z.string().min(1),
    fired: z.boolean(),
    values: z.record(z.string(), TechnicalEventValue),
    at: z.iso.date(),
  })
  .meta({ id: 'TechnicalEvent' });
export type TechnicalEvent = z.infer<typeof TechnicalEvent>;

export const TechnicalAnalysisArtifact = z
   .strictObject({
     schemaVersion: z.literal(SCHEMA_VERSIONS.technical),
     symbol: z.string().min(1),
    jobName: z.literal('analyze-technical'),
    asOf: z.iso.datetime({ offset: true }),
    timeframe: z.literal('1D'),
    facts: TechnicalFacts,
    events: z.array(TechnicalEvent),
    narrative: AnalysisNarrative,
    provenance: AnalysisProvenance,
    cost: ProspectusCostReport,
  })
  .meta({ id: 'TechnicalAnalysisArtifact' });
export type TechnicalAnalysisArtifact = z.infer<typeof TechnicalAnalysisArtifact>;

export const FundamentalMetricId = z.enum([
  'trailing_pe',
  'dividend_yield',
  'roe',
  'revenue_growth_qoq',
  'revenue_growth_yoy',
  'profit_growth_qoq',
  'profit_growth_yoy',
  'debt_to_equity',
  'operating_cash_flow',
]);
export type FundamentalMetricId = z.infer<typeof FundamentalMetricId>;

export const FundamentalMetric = z
  .strictObject({
    id: FundamentalMetricId,
    label: z.string().min(1),
    value: NullableNumber,
    unit: z.string().min(1),
    asOf: z.iso.date(),
  })
  .meta({ id: 'FundamentalMetric' });
export type FundamentalMetric = z.infer<typeof FundamentalMetric>;

export const FundamentalAnalysisArtifact = z
   .strictObject({
     schemaVersion: z.literal(SCHEMA_VERSIONS.fundamental),
     symbol: z.string().min(1),
    jobName: z.literal('analyze-fundamental'),
    asOf: z.iso.datetime({ offset: true }),
    period: z.enum(['quarterly', 'annual']),
    metrics: z.array(FundamentalMetric).min(9).max(9),
    narrative: AnalysisNarrative,
    provenance: AnalysisProvenance,
    cost: ProspectusCostReport,
  })
  .meta({ id: 'FundamentalAnalysisArtifact' });
export type FundamentalAnalysisArtifact = z.infer<
  typeof FundamentalAnalysisArtifact
>;
