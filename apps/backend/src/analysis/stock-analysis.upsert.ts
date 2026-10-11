import type { StockAnalysisStatus } from '../data/entities/enums';
import {
  stockCodeFromJobId,
  stockCodeFromFundamentalJobId,
} from '../jobbus/job-id-formats';

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

/** BullMQ dedup id prefix for `analyze-technical` (colon form). */
export const TECHNICAL_BULL_JOB_PREFIX = 'ta:';

/** BullMQ dedup id prefix for `analyze-fundamental` (colon form). */
export const FUNDAMENTAL_BULL_JOB_PREFIX = 'fa:';

/**
 * Extract stock code from technical analysis job ID (BullMQ or JobResult format).
 * Replaces both `stockCodeFromTechnicalBullJobId` and `stockCodeFromTechnicalJobResultId`.
 */
export function stockCodeFromTechnicalBullJobId(jobId: string): string | null {
  return stockCodeFromJobId(jobId);
}

/**
 * Extract stock code from technical analysis job ID (JobResult form).
 * Replaces the historical `stockCodeFromTechnicalJobResultId`.
 */
export function stockCodeFromTechnicalJobResultId(jobId: string): string | null {
  return stockCodeFromJobId(jobId);
}

/**
 * Extract stock code from fundamental analysis job ID (BullMQ or JobResult format).
 */
export function stockCodeFromFundamentalBullJobId(jobId: string): string | null {
  return stockCodeFromFundamentalJobId(jobId);
}

/**
 * Extract stock code from fundamental analysis job ID (JobResult form).
 */
export function stockCodeFromFundamentalJobResultId(jobId: string): string | null {
  return stockCodeFromFundamentalJobId(jobId);
}
