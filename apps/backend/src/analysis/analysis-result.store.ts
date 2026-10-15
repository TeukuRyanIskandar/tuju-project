import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { JobResult } from '@tuju/contracts';
import { AnalysisResult } from '../data/entities/analysis-result.entity';

type VerdictSummary = Extract<JobResult['summary'], { verdict: unknown }>;

/** A result carrying the verdict-bearing `Summary` variant (scaffold TA/FA). */
export type VerdictResult = JobResult & { summary: VerdictSummary };

/** Narrows a result to the verdict-bearing `Summary` variant. */
export function isVerdictResult(result: JobResult): result is VerdictResult {
  return 'verdict' in result.summary;
}

/**
 * The scaffold `analysis_results` table behind `POST /analysis` +
 * `GET /analysis/:correlationId` (ADR-0004 §2/§4, ticket-06 round-trip proof).
 *
 * NestJS is the SOLE Postgres writer: the worker writes the full artifact to
 * S3 and returns a claim-check pointer + thin summary over the JobBus. This
 * table holds verdict-bearing stock-analysis results only (verdict is a
 * required column); the stock-analysis job family (`StockAnalysis`)
 * routes them here. Verdict-less results land in the per-family tables.
 */
@Injectable()
export class AnalysisResultStore {
  private readonly logger = new Logger(AnalysisResultStore.name);

  constructor(
    @InjectRepository(AnalysisResult)
    private readonly repo: Repository<AnalysisResult>,
  ) {}

  async persist(result: VerdictResult): Promise<void> {
    const row = this.repo.create({
      correlationId: result.correlationId,
      jobId: result.jobId,
      symbol: this.symbolFromKey(result.pointer.key),
      verdict: result.summary.verdict,
    });
    await this.repo.save(row);
    this.logger.log({
      msg: 'analysis result persisted',
      correlationId: result.correlationId,
      jobId: result.jobId,
      verdict: result.summary.verdict,
      bucket: result.pointer.bucket,
      key: result.pointer.key,
    });
  }

  findByCorrelationId(
    correlationId: string,
  ): Promise<AnalysisResult | null> {
    return this.repo.findOne({
      where: { correlationId },
      order: { createdAt: 'DESC' },
    });
  }

  /** Best-effort symbol extraction from the artifact key (e.g. `analysis/ta/MAYBANK/...`). */
  private symbolFromKey(key: string): string {
    const parts = key.split('/');
    return parts.length >= 3 ? parts[2] : 'unknown';
  }
}
