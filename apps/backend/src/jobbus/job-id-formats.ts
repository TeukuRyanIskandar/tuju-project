/**
 * Unified job ID format definitions and parsers.
 * Both BullMQ (internal queue dedup) and JobResult (worker output) now use
 * colon-delimited format for consistency: `ta:${stockCode}:${timeframe}:${dateStr}`
 *
 * Pattern: `<type>:<stockCode>:<discriminator>:<asOfBucket>`
 * - type: 'technical', 'fundamental' (JobResult), or 'ta', 'fa' (BullMQ)
 * - stockCode: 4-digit stock code
 * - discriminator: timeframe (e.g. '1D', 'weekly') or period (e.g. 'quarterly', 'annual')
 * - asOfBucket: ISO hour bucket (e.g. '2026-09-29T05')
 */

/**
 * Regex patterns for job ID parsing.
 * Both formats (historical prefix-based and new unified) are matched for robustness.
 */
export const JOB_ID_FORMATS = {
  technical: {
    /** JobResult (colon-delimited): `technical:${stockCode}:${timeframe}:${asOfBucket}` */
    resultPattern: /^technical:([^:]+):([^:]+):(.+)$/,
    /** BullMQ dedup (colon-delimited): `ta:${stockCode}:${timeframe}:${asOfBucket}` */
    bullPattern: /^ta:([^:]+):([^:]+):(.+)$/,
  },
  fundamental: {
    /** JobResult (colon-delimited): `fundamental:${stockCode}:${period}:${asOfBucket}` */
    resultPattern: /^fundamental:([^:]+):([^:]+):(.+)$/,
    /** BullMQ dedup (colon-delimited): `fa:${stockCode}:${period}:${asOfBucket}` */
    bullPattern: /^fa:([^:]+):([^:]+):(.+)$/,
  },
  /** Prospectus job IDs (special case: single segment after prefix) */
  prospectus: {
    /** BullMQ dedup (hyphen-delimited): `prospectus-${prospectusId}` */
    bullPattern: /^prospectus-(.+)$/,
  },
} as const;

/**
 * Extract stock code from a technical analysis job ID (either BullMQ or JobResult format).
 * Returns null if the ID doesn't match either pattern.
 */
export function stockCodeFromJobId(jobId: string): string | null {
  let match = JOB_ID_FORMATS.technical.resultPattern.exec(jobId);
  if (match) return match[1] || null;
  match = JOB_ID_FORMATS.technical.bullPattern.exec(jobId);
  if (match) return match[1] || null;
  return null;
}

/**
 * Extract timeframe from a technical analysis job ID (either BullMQ or JobResult format).
 * Returns null if the ID doesn't match either pattern.
 */
export function timeframeFromJobId(jobId: string): string | null {
  let match = JOB_ID_FORMATS.technical.resultPattern.exec(jobId);
  if (match) return match[2] || null;
  match = JOB_ID_FORMATS.technical.bullPattern.exec(jobId);
  if (match) return match[2] || null;
  return null;
}

/**
 * Extract asOf bucket from a technical analysis job ID (either BullMQ or JobResult format).
 * Returns null if the ID doesn't match either pattern.
 */
export function dateFromJobId(jobId: string): string | null {
  let match = JOB_ID_FORMATS.technical.resultPattern.exec(jobId);
  if (match) return match[3] || null;
  match = JOB_ID_FORMATS.technical.bullPattern.exec(jobId);
  if (match) return match[3] || null;
  return null;
}

/**
 * Extract stock code from a fundamental analysis job ID (either BullMQ or JobResult format).
 * Returns null if the ID doesn't match either pattern.
 */
export function stockCodeFromFundamentalJobId(jobId: string): string | null {
  let match = JOB_ID_FORMATS.fundamental.resultPattern.exec(jobId);
  if (match) return match[1] || null;
  match = JOB_ID_FORMATS.fundamental.bullPattern.exec(jobId);
  if (match) return match[1] || null;
  return null;
}

/**
 * Extract period from a fundamental analysis job ID (either BullMQ or JobResult format).
 * Returns null if the ID doesn't match either pattern.
 */
export function periodFromJobId(jobId: string): string | null {
  let match = JOB_ID_FORMATS.fundamental.resultPattern.exec(jobId);
  if (match) return match[2] || null;
  match = JOB_ID_FORMATS.fundamental.bullPattern.exec(jobId);
  if (match) return match[2] || null;
  return null;
}

/**
 * Extract asOf bucket from a fundamental analysis job ID (either BullMQ or JobResult format).
 * Returns null if the ID doesn't match either pattern.
 */
export function dateFromFundamentalJobId(jobId: string): string | null {
  let match = JOB_ID_FORMATS.fundamental.resultPattern.exec(jobId);
  if (match) return match[3] || null;
  match = JOB_ID_FORMATS.fundamental.bullPattern.exec(jobId);
  if (match) return match[3] || null;
  return null;
}
