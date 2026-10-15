/**
 * KLCI 30 TA/FA ops enqueue (PoC Phase A backend build ticket 05).
 *
 * Behind `enqueue-klci` in worker-main: fans out system-triggered
 * `analyze-technical` + `analyze-fundamental` for the KLCI 30 (or one code).
 * Same path is called after a successful nightly ingest whose market adapter
 * serves the `klci30` universe (yfinance today).
 *
 * Skip (non-force): analysis row `status ∈ {ready, facts_only}` and
 * `as_of`/`updated_at` same UTC calendar day. On enqueue: row → pending.
 * Enqueues with `replaceFinished` so a retained completed/failed job does not
 * swallow `--force` within the hour-bucket retention window; a true in-flight
 * job collapses (reported as `alreadyInFlight`).
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
import type { StockAnalysisJob } from '../jobbus/job-identities';
import { JobNames } from '../jobbus/job-names';
import { StockAnalysis } from '../analysis/stock-analysis';
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
    private readonly analyses: StockAnalysis,
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
        instrument,
        jobName: JobNames.technical,
        force,
        now,
        result,
      });
      await this.enqueueOne({
        instrument,
        jobName: JobNames.fundamental,
        force,
        now,
        result,
      });
    }

    this.logger.log({ msg: 'enqueue-klci done', ...result });
    return result;
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
    instrument: Instrument;
    jobName: StockAnalysisJob;
    force: boolean;
    now: Date;
    result: KlciEnqueueResult;
  }): Promise<void> {
    const { instrument, jobName, force, now, result } = args;
    const { stockCode } = instrument;
    const key = `${stockCode}:${jobName}`;

    try {
      const row = await this.analyses.findByInstrumentId(jobName, instrument.id);
      if (shouldSkipSameDayAnalysis(row, now, force)) {
        result.skipped.push(key);
        return;
      }

      const envelope: JobEnvelope<TechnicalPayload | FundamentalPayload> =
        jobName === JobNames.technical
          ? buildTechnicalEnvelope(stockCode, now)
          : buildFundamentalEnvelope(stockCode, now);
      const { jobId, status } = await this.jobBus.enqueue(jobName, envelope, {
        replaceFinished: true,
      });
      if (status === 'inFlight') {
        result.alreadyInFlight.push(key);
        return;
      }
      // Marked after the add (an enqueue that throws leaves the row alone);
      // markPending refuses to overwrite this job's own result if the worker
      // landed it first.
      await this.analyses.markPending(jobName, instrument, {
        correlationId: envelope.correlationId,
        jobId,
      });
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
