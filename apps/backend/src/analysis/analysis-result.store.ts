import {
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { JobResult } from '@tuju/contracts';
import { JobBus } from '../jobbus/job-bus.service';
import { AnalysisResult } from '../data/entities/analysis-result.entity';

/**
 * Persists the AI worker's JobResult into Postgres (ADR-0004 §2/§4).
 *
 * NestJS is the SOLE Postgres writer: the Python worker writes the full artifact
 * to S3 and returns a claim-check pointer + thin summary over the JobBus; this
 * subscriber records the Postgres index-of-record row. It closes the ticket-06
 * round-trip: worker returnvalue → JobBus 'completed' → this row → FE read.
 */
@Injectable()
export class AnalysisResultStore implements OnModuleInit {
  private readonly logger = new Logger(AnalysisResultStore.name);

  constructor(
    private readonly jobBus: JobBus,
    @InjectRepository(AnalysisResult)
    private readonly repo: Repository<AnalysisResult>,
  ) {}

  onModuleInit(): void {
    // Subscribe to completed results and persist them (ADR-0007 §7 hand-off).
    this.jobBus.onResult((result: JobResult) => {
      void this.persist(result);
    });
  }

  private async persist(result: JobResult): Promise<void> {
    try {
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
    } catch (err) {
      this.logger.error({
        msg: 'failed to persist analysis result',
        correlationId: result.correlationId,
        jobId: result.jobId,
        error: (err as Error).message,
      });
    }
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
