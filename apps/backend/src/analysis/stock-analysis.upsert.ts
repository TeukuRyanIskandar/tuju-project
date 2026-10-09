import type { StockAnalysisStatus } from '../data/entities/enums';

export type StockAnalysisUpsertInput = {
  instrumentId: string;
  status: StockAnalysisStatus;
  correlationId: string;
  jobId: string;
  headline?: string | null;
  asOf?: Date | null;
  artifactBucket?: string | null;
  artifactKey?: string | null;
  errorMessage?: string | null;
};

/** `JobResult.jobId` prefix for PoC `analyze-technical` (colon form). */
export const TECHNICAL_JOB_RESULT_PREFIX = 'technical:';

/** `JobResult.jobId` prefix for PoC `analyze-fundamental` (colon form). */
export const FUNDAMENTAL_JOB_RESULT_PREFIX = 'fundamental:';

/** BullMQ dedup id prefix for `analyze-technical` (hyphen form). */
export const TECHNICAL_BULL_JOB_PREFIX = 'ta-';

/** BullMQ dedup id prefix for `analyze-fundamental` (hyphen form). */
export const FUNDAMENTAL_BULL_JOB_PREFIX = 'fa-';

export function stockCodeFromTechnicalJobResultId(jobId: string): string | null {
  if (!jobId.startsWith(TECHNICAL_JOB_RESULT_PREFIX)) return null;
  const rest = jobId.slice(TECHNICAL_JOB_RESULT_PREFIX.length);
  const stockCode = rest.split(':')[0];
  return stockCode || null;
}

export function stockCodeFromFundamentalJobResultId(jobId: string): string | null {
  if (!jobId.startsWith(FUNDAMENTAL_JOB_RESULT_PREFIX)) return null;
  const rest = jobId.slice(FUNDAMENTAL_JOB_RESULT_PREFIX.length);
  const stockCode = rest.split(':')[0];
  return stockCode || null;
}

export function stockCodeFromTechnicalBullJobId(jobId: string): string | null {
  if (!jobId.startsWith(TECHNICAL_BULL_JOB_PREFIX)) return null;
  const rest = jobId.slice(TECHNICAL_BULL_JOB_PREFIX.length);
  const stockCode = rest.split('-')[0];
  return stockCode || null;
}

export function stockCodeFromFundamentalBullJobId(jobId: string): string | null {
  if (!jobId.startsWith(FUNDAMENTAL_BULL_JOB_PREFIX)) return null;
  const rest = jobId.slice(FUNDAMENTAL_BULL_JOB_PREFIX.length);
  const stockCode = rest.split('-')[0];
  return stockCode || null;
}
