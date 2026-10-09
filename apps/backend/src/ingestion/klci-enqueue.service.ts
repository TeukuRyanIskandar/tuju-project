/**
 * KLCI 30 TA/FA ops enqueue (PoC Phase A backend build ticket 05).
 *
 * Behind `enqueue-klci` in worker-main: fans out system-triggered
 * `analyze-technical` + `analyze-fundamental` for the KLCI 30 (or one code).
 * Same path is called after successful nightly ingest when yfinance is bound.
 *
 * Skip (non-force): analysis row `status ∈ {ready, facts_only}` and
 * `as_of`/`updated_at` same UTC calendar day. On enqueue: upsert row → pending.
 * Clears completed/failed BullMQ jobs (prospectus pattern) so `--force` works
 * within the hour-bucket retention window; leaves true in-flight as collapse.
 */

import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  FundamentalPayload,
  JobEnvelope,
  TechnicalPayload,
} from '@tuju/contracts';
import { Instrument } from '../data/entities/instrument.entity';
import { FundamentalAnalysis } from '../data/entities/fundamental-analysis.entity';
import { TechnicalAnalysis } from '../data/entities/technical-analysis.entity';
import { StockAnalysisStatus } from '../data/entities/enums';
import { JobBus } from '../jobbus/job-bus.service';
import { JobNames } from '../jobbus/job-names';
import { TechnicalAnalysisStore } from '../analysis/technical-analysis.store';
import { FundamentalAnalysisStore } from '../analysis/fundamental-analysis.store';
import {
  getKlci30Row,
  isKlci30,
  KLCI30_UNIVERSE,
} from './klci30-universe';

export type KlciEnqueueOptions = {
  stockCode?: string;
  force?: boolean;
  now?: Date;
};

export type KlciEnqueueResult = {
  enqueued: string[];
  skipped: string[];
  alreadyInFlight: string[];
  failed: string[];
};

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Skip ready/facts_only when asOf (fallback updatedAt) is the same UTC day. */
export function shouldSkipSameDayAnalysis(
  row:
    | Pick<
        TechnicalAnalysis | FundamentalAnalysis,
        'status' | 'asOf' | 'updatedAt'
      >
    | null,
  now: Date,
  force: boolean,
): boolean {
  if (force || row == null) return false;
  if (
    row.status !== StockAnalysisStatus.Ready &&
    row.status !== StockAnalysisStatus.FactsOnly
  ) {
    return false;
  }
  const anchor = row.asOf ?? row.updatedAt;
  return utcDay(anchor) === utcDay(now);
}

/**
 * BullMQ dedup id for TA/FA (mirrors JobBus.deriveJobId default branch).
 * Kept here so ops can clear completed/failed before enqueue.
 */
export function taFaBullJobId(
  prefix: 'ta' | 'fa',
  symbol: string,
  discriminator: string,
  asOfIso: string,
): string {
  const asOfBucket = asOfIso.slice(0, 13);
  return [prefix, symbol, discriminator, asOfBucket].join('-').replace(/:/g, '-');
}

export function buildTechnicalEnvelope(
  stockCode: string,
  now: Date = new Date(),
): JobEnvelope<TechnicalPayload> {
  return {
    correlationId: randomUUID(),
    requestedBy: 'system',
    trigger: 'system',
    asOf: now.toISOString(),
    payload: { symbol: stockCode, timeframe: '1D' },
  };
}

export function buildFundamentalEnvelope(
  stockCode: string,
  now: Date = new Date(),
): JobEnvelope<FundamentalPayload> {
  return {
    correlationId: randomUUID(),
    requestedBy: 'system',
    trigger: 'system',
    asOf: now.toISOString(),
    payload: { symbol: stockCode, period: 'quarterly' },
  };
}

@Injectable()
export class KlciEnqueueService {
  private readonly logger = new Logger(KlciEnqueueService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly jobBus: JobBus,
    private readonly technical: TechnicalAnalysisStore,
    private readonly fundamental: FundamentalAnalysisStore,
  ) {}

  async enqueue(opts: KlciEnqueueOptions = {}): Promise<KlciEnqueueResult> {
    const force = opts.force === true;
    const now = opts.now ?? new Date();
    const codes = this.resolveCodes(opts.stockCode);

    const result: KlciEnqueueResult = {
      enqueued: [],
      skipped: [],
      alreadyInFlight: [],
      failed: [],
    };

    for (const stockCode of codes) {
      const instrument = await this.dataSource
        .getRepository(Instrument)
        .findOne({ where: { stockCode } });
      if (!instrument) {
        this.logger.warn({
          msg: 'enqueue-klci: no instrument; run seed-klci',
          stockCode,
        });
        result.failed.push(`${stockCode}:missing-instrument`);
        continue;
      }

      await this.enqueueOne({
        stockCode,
        instrumentId: instrument.id,
        jobName: JobNames.technical,
        force,
        now,
        result,
      });
      await this.enqueueOne({
        stockCode,
        instrumentId: instrument.id,
        jobName: JobNames.fundamental,
        force,
        now,
        result,
      });
    }

    this.logger.log({ msg: 'enqueue-klci done', ...result });
    return result;
  }

  /** @returns true if caller should skip enqueue (already in flight). */
  private async clearOrSkipInFlight(
    derivedJobId: string,
    key: string,
    result: KlciEnqueueResult,
  ): Promise<boolean> {
    const existing = await this.jobBus.getQueue().getJob(derivedJobId);
    if (!existing) return false;
    const state = await existing.getState();
    if (state === 'completed' || state === 'failed') {
      await existing.remove();
      return false;
    }
    result.alreadyInFlight.push(key);
    return true;
  }

  private resolveCodes(stockCode?: string): string[] {
    if (stockCode === undefined) {
      return KLCI30_UNIVERSE.map((r) => r.stockCode);
    }
    if (!isKlci30(stockCode) || getKlci30Row(stockCode) === undefined) {
      throw new Error(
        `enqueue-klci: ${stockCode} is not in the KLCI 30 universe`,
      );
    }
    return [stockCode];
  }

  private async enqueueOne(args: {
    stockCode: string;
    instrumentId: string;
    jobName: typeof JobNames.technical | typeof JobNames.fundamental;
    force: boolean;
    now: Date;
    result: KlciEnqueueResult;
  }): Promise<void> {
    const { stockCode, instrumentId, jobName, force, now, result } = args;
    const key = `${stockCode}:${jobName}`;

    try {
      const isTa = jobName === JobNames.technical;
      const row = isTa
        ? await this.technical.findByInstrumentId(instrumentId)
        : await this.fundamental.findByInstrumentId(instrumentId);

      if (shouldSkipSameDayAnalysis(row, now, force)) {
        result.skipped.push(key);
        return;
      }

      if (isTa) {
        const envelope = buildTechnicalEnvelope(stockCode, now);
        const derivedJobId = taFaBullJobId('ta', stockCode, '1D', envelope.asOf);
        if (await this.clearOrSkipInFlight(derivedJobId, key, result)) return;
        const { jobId } = await this.jobBus.enqueue(
          JobNames.technical,
          envelope,
        );
        await this.technical.upsert({
          instrumentId,
          status: StockAnalysisStatus.Pending,
          correlationId: envelope.correlationId,
          jobId,
          headline: null,
          asOf: null,
          artifactBucket: null,
          artifactKey: null,
          errorMessage: null,
        });
      } else {
        const envelope = buildFundamentalEnvelope(stockCode, now);
        const derivedJobId = taFaBullJobId(
          'fa',
          stockCode,
          'quarterly',
          envelope.asOf,
        );
        if (await this.clearOrSkipInFlight(derivedJobId, key, result)) return;
        const { jobId } = await this.jobBus.enqueue(
          JobNames.fundamental,
          envelope,
        );
        await this.fundamental.upsert({
          instrumentId,
          status: StockAnalysisStatus.Pending,
          correlationId: envelope.correlationId,
          jobId,
          headline: null,
          asOf: null,
          artifactBucket: null,
          artifactKey: null,
          errorMessage: null,
        });
      }

      result.enqueued.push(key);
    } catch (err) {
      this.logger.error({
        msg: 'enqueue-klci: per-job failure; continuing',
        stockCode,
        jobName,
        error: (err as Error).message,
      });
      result.failed.push(key);
    }
  }
}
