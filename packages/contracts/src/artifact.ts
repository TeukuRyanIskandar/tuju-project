import { z } from 'zod';

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
    themes: z.array(ProspectusRiskTheme).min(1), // ordered by rank
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

export const ProspectusInsights = z
  .strictObject({
    shariah: ProspectusShariahInsight,
    cornerstone: ProspectusCornerstoneInsight,
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

// --- the artifact -----------------------------------------------------------
export const ProspectusArtifact = z
  .strictObject({
    schemaVersion: z.literal('prospectus-at-a-glance-1'),
    prospectusId: z.string().min(1),
    provenance: ProspectusProvenance,
    company: ProspectusCompany,
    headline: z.string().min(1), // == sections.whatToWatch.data.headline
    sections: ProspectusSections,
    insights: ProspectusInsights,
    cost: ProspectusCostReport,
    parse: ProspectusParseInfo,
  })
  .meta({ id: 'ProspectusArtifact' });
export type ProspectusArtifact = z.infer<typeof ProspectusArtifact>;
