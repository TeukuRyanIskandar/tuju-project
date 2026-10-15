import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { S3Client } from '@aws-sdk/client-s3';
import { Repository } from 'typeorm';
import type { JobFailure, JobResult } from '@tuju/contracts';
import { JobBus } from '../jobbus/job-bus.service';
import type { JobFamily, JobRef } from '../jobbus/job-family';
import {
  stockAnalysisIdentity,
  type StockAnalysisJob,
  type StockAnalysisKey,
} from '../jobbus/job-identities';
import { JobNames } from '../jobbus/job-names';
import {
  ReadModelCache,
  ReadModelReads,
  type StockAnalysisKind,
} from '../cache';
import { TechnicalAnalysis } from '../data/entities/technical-analysis.entity';
import { FundamentalAnalysis } from '../data/entities/fundamental-analysis.entity';
import { Instrument } from '../data/entities/instrument.entity';
import { PriceBar } from '../data/entities/price-bar.entity';
import { StockAnalysisStatus } from '../data/entities/enums';
import { isKlci30 } from '../ingestion/klci30-universe';
import { readArtifactJson } from '../s3/artifact-proxy';
import { S3_CLIENT } from '../s3/s3.module';
import { AnalysisResultStore, isVerdictResult } from './analysis-result.store';
import {
  canGoStale,
  jobNameOf,
  kindOf,
  omitArtifactCost,
  promoteStale,
  toEnvelope,
  type StockAnalysisEnvelope,
} from './stock-analysis-envelope';

/** TA and FA rows have the same shape; one table per job. */
type StockAnalysisRow = TechnicalAnalysis | FundamentalAnalysis;

type StockAnalysisRef = JobRef<StockAnalysisJob, StockAnalysisKey>;

type RowWrite = Pick<
  StockAnalysisRow,
  | 'instrumentId'
  | 'status'
  | 'correlationId'
  | 'jobId'
  | 'headline'
  | 'asOf'
  | 'artifactBucket'
  | 'artifactKey'
  | 'errorMessage'
>;

/**
 * Stock analysis: the TA/FA lifecycle of one KLCI-30 stock, writes and reads
 * behind one interface. Two thin status tables (`technical_analyses` /
 * `fundamental_analyses`, one row per instrument, PoC Phase A) hold it.
 *
 * Writes:
 * - {@link markPending} when a fresh job is enqueued (clears the last result).
 *   It never undoes its own job's result: a row that already holds this
 *   envelope's `correlationId` in a non-pending state is left alone, so a
 *   worker that lands before the enqueuer marks pending is not overwritten.
 * - {@link land} (the job family, via the JobBus) writes `ready`, or
 *   `facts_only` when the worker's grounding/cost guard fell back to a
 *   facts-only headline. A verdict-bearing result is the scaffold
 *   `POST /analysis` shape and lands in `analysis_results` instead.
 * - {@link fail} writes `failed` under the failed job's `correlationId`
 *   (so a late {@link markPending} for that job is refused), keeping the last
 *   good headline/artifact. A failure of an older job while a newer one is
 *   pending is ignored.
 * Each write announces `stockAnalysisChanged` to the read-model cache.
 *
 * Reads (KLCI-30 hard-gated; unknown/outside → 404):
 * - {@link status}: the thin envelope; `pending` when no row. `stale` is
 *   promoted (a landed result whose `asOf` day is behind the stock's latest
 *   EOD close day) inside the class-2 loader: the only writers of price bars,
 *   the EOD ingest and the purge, clear `cache:stocks:*`, so a cached
 *   envelope never outlives the close that would make it stale.
 * - {@link artifact}: the proxied S3 artifact JSON with `cost` stripped
 *   (ADR-0014); 404 when the row has no pointer.
 */
@Injectable()
export class StockAnalysis
  implements JobFamily<StockAnalysisJob, StockAnalysisKey>, OnModuleInit
{
  readonly identity = stockAnalysisIdentity;
  private readonly logger = new Logger(StockAnalysis.name);

  constructor(
    private readonly jobBus: JobBus,
    @InjectRepository(TechnicalAnalysis)
    private readonly technical: Repository<TechnicalAnalysis>,
    @InjectRepository(FundamentalAnalysis)
    private readonly fundamental: Repository<FundamentalAnalysis>,
    @InjectRepository(Instrument)
    private readonly instruments: Repository<Instrument>,
    @InjectRepository(PriceBar)
    private readonly priceBars: Repository<PriceBar>,
    private readonly legacy: AnalysisResultStore,
    private readonly readCache: ReadModelCache,
    @Inject(S3_CLIENT) private readonly s3: S3Client,
  ) {}

  onModuleInit(): void {
    this.jobBus.register(this);
  }

  // ─── reads ──────────────────────────────────────────────────────────────

  /** `GET /stocks/:code/analysis/{kind}` — the thin status envelope. */
  async status<K extends StockAnalysisKind>(
    stockCode: string,
    kind: K,
  ): Promise<StockAnalysisEnvelope<K>> {
    return this.cachedEnvelope(stockCode, kind);
  }

  /** `GET /stocks/:code/analysis/{kind}/artifact` — proxied, `cost` stripped. */
  async artifact(
    stockCode: string,
    kind: StockAnalysisKind,
  ): Promise<Record<string, unknown>> {
    const { artifact } = await this.cachedEnvelope(stockCode, kind);
    if (!artifact) {
      throw new NotFoundException(
        `No analysis artifact for stockCode=${stockCode}`,
      );
    }
    const body = await readArtifactJson(
      this.s3,
      artifact,
      `Analysis artifact body is empty for stockCode=${stockCode}`,
    );
    return omitArtifactCost(body);
  }

  /** The current row (the enqueuer's same-day skip check). */
  findByInstrumentId(
    jobName: StockAnalysisJob,
    instrumentId: string,
  ): Promise<StockAnalysisRow | null> {
    return this.repo(jobName).findOne({ where: { instrumentId } });
  }

  // ─── writes ─────────────────────────────────────────────────────────────

  /**
   * A fresh job was enqueued: reset the row to pending. Returns `false` (and
   * writes nothing) when the row already holds this job's result — the
   * worker beat the enqueuer.
   */
  async markPending(
    jobName: StockAnalysisJob,
    instrument: Pick<Instrument, 'id' | 'stockCode'>,
    job: { correlationId: string; jobId: string },
  ): Promise<boolean> {
    const repo = this.repo(jobName);
    const pending = {
      status: StockAnalysisStatus.Pending,
      correlationId: job.correlationId,
      jobId: job.jobId,
      headline: null,
      asOf: null,
      artifactBucket: null,
      artifactKey: null,
      errorMessage: null,
      updatedAt: new Date(),
    };
    // One conditional UPDATE (atomic with its WHERE under Postgres row locks),
    // then an INSERT for a never-analysed instrument. A conflict on the insert
    // means the row exists but the guard refused it.
    const updated = await repo
      .createQueryBuilder()
      .update()
      .set(pending)
      .where('instrument_id = :instrumentId', { instrumentId: instrument.id })
      .andWhere('(correlation_id <> :correlationId OR status = :pendingStatus)', {
        correlationId: job.correlationId,
        pendingStatus: StockAnalysisStatus.Pending,
      })
      .execute();
    let marked = (updated.affected ?? 0) > 0;
    if (!marked) {
      const inserted = await repo
        .createQueryBuilder()
        .insert()
        .values({ instrumentId: instrument.id, ...pending })
        .orIgnore()
        .execute();
      marked = (inserted.raw as unknown[]).length > 0;
    }
    if (!marked) {
      this.logger.log({
        msg: 'stock analysis: result already landed; pending not written',
        jobName,
        jobId: job.jobId,
        correlationId: job.correlationId,
        stockCode: instrument.stockCode,
      });
      return false;
    }
    await this.announce(jobName, instrument.stockCode);
    return true;
  }

  async land(result: JobResult, ref: StockAnalysisRef): Promise<void> {
    if (isVerdictResult(result)) {
      await this.legacy.persist(result);
      return;
    }

    const instrument = await this.instrumentFor(ref, result.jobId);
    if (!instrument) return;

    await this.write(ref.jobName, {
      instrumentId: instrument.id,
      status: result.summary.headline.startsWith('facts-only: ')
        ? StockAnalysisStatus.FactsOnly
        : StockAnalysisStatus.Ready,
      correlationId: result.correlationId,
      jobId: result.jobId,
      headline: result.summary.headline,
      asOf: new Date(result.summary.asOf),
      artifactBucket: result.pointer.bucket,
      artifactKey: result.pointer.key,
      errorMessage: null,
    });
    await this.announce(ref.jobName, ref.key.stockCode);
    this.logger.log({
      msg: 'stock analysis persisted',
      jobName: ref.jobName,
      correlationId: result.correlationId,
      jobId: result.jobId,
      instrumentId: instrument.id,
      stockCode: ref.key.stockCode,
    });
  }

  async fail(failure: JobFailure, ref: StockAnalysisRef): Promise<void> {
    const instrument = await this.instrumentFor(ref, failure.jobId);
    if (!instrument) return;

    const existing = await this.findByInstrumentId(ref.jobName, instrument.id);
    if (
      existing?.status === StockAnalysisStatus.Pending &&
      existing.correlationId !== failure.correlationId
    ) {
      this.logger.warn({
        msg: 'stock analysis: failure of a superseded job ignored',
        jobName: ref.jobName,
        jobId: failure.jobId,
        correlationId: failure.correlationId,
        pendingCorrelationId: existing.correlationId,
        stockCode: ref.key.stockCode,
      });
      return;
    }
    await this.write(ref.jobName, {
      instrumentId: instrument.id,
      status: StockAnalysisStatus.Failed,
      // This job's id, not the last good result's: markPending's guard keys
      // on it, so a pending write arriving after this failure is refused.
      correlationId: failure.correlationId,
      jobId: failure.jobId,
      headline: existing?.headline ?? null,
      asOf: existing?.asOf ?? null,
      artifactBucket: existing?.artifactBucket ?? null,
      artifactKey: existing?.artifactKey ?? null,
      errorMessage: failure.userMessage,
    });
    await this.announce(ref.jobName, ref.key.stockCode);
    this.logger.error({
      msg: 'stock analysis job failed',
      jobName: ref.jobName,
      jobId: failure.jobId,
      instrumentId: instrument.id,
      stockCode: ref.key.stockCode,
      reason: failure.userMessage,
    });
  }

  // ─── internals ──────────────────────────────────────────────────────────

  /**
   * The envelope with `stale` promoted, class-2 cached under
   * `stockAnalysis(code, kind)`. Every row write announces and every price-bar
   * write sweeps `cache:stocks:`, so the cache outlives neither; a 404 is
   * thrown through the loader and never cached.
   */
  private cachedEnvelope<K extends StockAnalysisKind>(
    stockCode: string,
    kind: K,
  ): Promise<StockAnalysisEnvelope<K>> {
    if (!isKlci30(stockCode)) return Promise.reject(this.notFound(stockCode));
    return this.readCache.read(ReadModelReads.stockAnalysis(stockCode, kind), async () => {
      const instrument = await this.instruments.findOne({ where: { stockCode } });
      if (!instrument) throw this.notFound(stockCode);
      const row = await this.findByInstrumentId(jobNameOf(kind), instrument.id);
      const envelope = toEnvelope(stockCode, kind, row);
      if (!canGoStale(envelope)) return envelope;
      return promoteStale(envelope, await this.latestEodCloseDay(instrument.id));
    });
  }

  private async latestEodCloseDay(instrumentId: string): Promise<string | null> {
    const latest = await this.priceBars.findOne({
      where: { instrumentId },
      order: { tradeDate: 'DESC' },
    });
    return latest?.tradeDate ?? null;
  }

  private notFound(stockCode: string): NotFoundException {
    return new NotFoundException(`No stock found for stockCode=${stockCode}`);
  }

  private announce(jobName: StockAnalysisJob, stockCode: string): Promise<void> {
    return this.readCache.changed({
      kind: 'stockAnalysisChanged',
      stockCode,
      analysis: kindOf(jobName),
    });
  }

  private repo(jobName: StockAnalysisJob): Repository<StockAnalysisRow> {
    return (
      jobName === JobNames.technical ? this.technical : this.fundamental
    ) as Repository<StockAnalysisRow>;
  }

  private async instrumentFor(
    ref: StockAnalysisRef,
    jobId: string,
  ): Promise<Instrument | null> {
    const instrument = await this.instruments.findOne({
      where: { stockCode: ref.key.stockCode },
    });
    if (!instrument) {
      this.logger.warn({
        msg: 'stock analysis: no instrument for stockCode',
        jobName: ref.jobName,
        jobId,
        stockCode: ref.key.stockCode,
      });
    }
    return instrument;
  }

  private async write(jobName: StockAnalysisJob, input: RowWrite): Promise<void> {
    const repo = this.repo(jobName);
    await repo.upsert(repo.create({ ...input, updatedAt: new Date() }), [
      'instrumentId',
    ]);
  }
}
