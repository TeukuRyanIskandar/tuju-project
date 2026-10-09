import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import type { JobFailure, JobResult } from '@tuju/contracts';
import { JobBus } from '../jobbus/job-bus.service';
import { isVerdictSummary } from '../jobbus/job-result-helpers';
import { TechnicalAnalysis } from '../data/entities/technical-analysis.entity';
import { Instrument } from '../data/entities/instrument.entity';
import { StockAnalysisStatus } from '../data/entities/enums';
import { isUuid } from '../stocks/filters';
import {
  stockCodeFromTechnicalBullJobId,
  stockCodeFromTechnicalJobResultId,
  TECHNICAL_BULL_JOB_PREFIX,
  type StockAnalysisUpsertInput,
} from './stock-analysis.upsert';

@Injectable()
export class TechnicalAnalysisStore implements OnModuleInit {
  private readonly logger = new Logger(TechnicalAnalysisStore.name);

  constructor(
    private readonly jobBus: JobBus,
    @InjectRepository(TechnicalAnalysis)
    private readonly repo: Repository<TechnicalAnalysis>,
    @InjectRepository(Instrument)
    private readonly instruments: Repository<Instrument>,
  ) {}

  onModuleInit(): void {
    this.jobBus.onResult((result: JobResult) => {
      void this.onResult(result);
    });
    this.jobBus.onFailure((failure: JobFailure) => {
      void this.onFailure(failure);
    });
  }

  async upsert(input: StockAnalysisUpsertInput): Promise<void> {
    const now = new Date();
    const row = this.repo.create({
      instrumentId: input.instrumentId,
      status: input.status,
      correlationId: input.correlationId,
      jobId: input.jobId,
      headline: input.headline ?? null,
      asOf: input.asOf ?? null,
      artifactBucket: input.artifactBucket ?? null,
      artifactKey: input.artifactKey ?? null,
      errorMessage: input.errorMessage ?? null,
      updatedAt: now,
    });
    await this.repo.upsert(row, ['instrumentId']);
  }

  findByInstrumentId(instrumentId: string): Promise<TechnicalAnalysis | null> {
    return this.repo.findOne({ where: { instrumentId } });
  }

  private async onResult(result: JobResult): Promise<void> {
    const stockCode = stockCodeFromTechnicalJobResultId(result.jobId);
    if (stockCode === null) return;
    if (isVerdictSummary(result.summary)) return;

    const instrument = await this.instruments.findOne({
      where: { stockCode },
    });
    if (!instrument) {
      this.logger.warn({
        msg: 'technical analysis: no instrument for stockCode',
        correlationId: result.correlationId,
        jobId: result.jobId,
        stockCode,
      });
      return;
    }

    try {
      await this.upsert({
        instrumentId: instrument.id,
        status: StockAnalysisStatus.Ready,
        correlationId: result.correlationId,
        jobId: result.jobId,
        headline: result.summary.headline,
        asOf: new Date(result.summary.asOf),
        artifactBucket: result.pointer.bucket,
        artifactKey: result.pointer.key,
        errorMessage: null,
      });
      this.logger.log({
        msg: 'technical analysis persisted',
        correlationId: result.correlationId,
        jobId: result.jobId,
        instrumentId: instrument.id,
        stockCode,
      });
    } catch (err) {
      this.logger.error({
        msg: 'failed to persist technical analysis',
        correlationId: result.correlationId,
        jobId: result.jobId,
        stockCode,
        error: (err as Error).message,
      });
    }
  }

  private async onFailure(failure: JobFailure): Promise<void> {
    if (!failure.jobId.startsWith(TECHNICAL_BULL_JOB_PREFIX)) return;
    const stockCode = stockCodeFromTechnicalBullJobId(failure.jobId);
    if (stockCode === null) return;

    const instrument = await this.instruments.findOne({
      where: { stockCode },
    });
    if (!instrument) {
      this.logger.warn({
        msg: 'technical analysis failure: no instrument for stockCode',
        jobId: failure.jobId,
        stockCode,
      });
      return;
    }

    const existing = await this.findByInstrumentId(instrument.id);
    const correlationId =
      existing?.correlationId ??
      (isUuid(failure.correlationId) ? failure.correlationId : randomUUID());

    try {
      await this.upsert({
        instrumentId: instrument.id,
        status: StockAnalysisStatus.Failed,
        correlationId,
        jobId: failure.jobId,
        headline: existing?.headline ?? null,
        asOf: existing?.asOf ?? null,
        artifactBucket: existing?.artifactBucket ?? null,
        artifactKey: existing?.artifactKey ?? null,
        errorMessage: failure.userMessage,
      });
      this.logger.error({
        msg: 'technical analysis job failed',
        jobId: failure.jobId,
        instrumentId: instrument.id,
        stockCode,
        reason: failure.userMessage,
      });
    } catch (err) {
      this.logger.error({
        msg: 'failed to persist technical analysis failure',
        jobId: failure.jobId,
        stockCode,
        error: (err as Error).message,
      });
    }
  }
}
