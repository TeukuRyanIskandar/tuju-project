/**
 * Stock analysis module, through its interface, against real Postgres + Redis
 * (testcontainers) with an S3 fake. Results and failures arrive through the
 * in-memory JobBus, as BullMQ would deliver them.
 *
 *   1. pending (no row) → markPending → ready (land) → stale (a newer EOD bar)
 *      → failed (keeps the last good headline/artifact).
 *   2. The envelope is class-2 cached, and the cached copy stays correct:
 *      every write invalidates it, and `stale` is promoted after the cache
 *      (the cached entry still says `ready` while the response says `stale`).
 *   3. markPending never undoes its own job's result (the worker beat the
 *      enqueuer), but a fresh job (new correlationId) still resets the row.
 *   4. The artifact proxy strips `cost`; KLCI-30 gate and missing rows 404.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import type { S3Client } from '@aws-sdk/client-s3';
import {
  parseOrThrow,
  StockFundamentalAnalysisResponse,
  StockTechnicalAnalysisResponse,
  type JobEnvelope,
  type JobResult,
} from '@tuju/contracts';
import IORedis, { type Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import * as entities from '../data/entities';
import { MIGRATIONS } from '../data/migrations';
import {
  ListingBoard,
  ProvenanceClass,
  StockAnalysisStatus,
} from '../data/entities/enums';
import { ReadModelCache, ReadModelReads } from '../cache';
import type { AppConfig } from '../config/config';
import { InMemoryJobBus } from '../jobbus/in-memory-job-bus';
import { JobNames } from '../jobbus/job-names';
import {
  buildFundamentalEnvelope,
  buildTechnicalEnvelope,
} from '../ingestion/klci-enqueue.service';
import { AnalysisResultStore } from './analysis-result.store';
import { StockAnalysis } from './stock-analysis';

jest.setTimeout(180_000);

const FIXTURES = resolve(__dirname, '../../../../packages/contracts/fixtures');
const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(resolve(FIXTURES, name), 'utf-8')) as T;

const TECHNICAL_RESULT = fixture<JobResult>('job-result-technical-system.json');
const TECHNICAL_ARTIFACT = fixture<Record<string, unknown>>(
  'technical-analysis-artifact.json',
);

/** The fixture result's asOf hour, so bull ids and result ids line up. */
const NOW = new Date('2026-10-08T18:00:00.000Z');
const MAYBANK = '1155';
/** Seeded, but outside the KLCI 30 (hard-gated). */
const INARI = '0200';

const ALL_ENTITIES = Object.values(entities).filter((v) => typeof v === 'function');

describe('StockAnalysis (Postgres + Redis, S3 fake)', () => {
  let pg: StartedPostgreSqlContainer;
  let redisC: StartedRedisContainer;
  let dataSource: DataSource;
  let redis: Redis;
  let bus: InMemoryJobBus;
  let analyses: StockAnalysis;
  let readCache: ReadModelCache;
  let s3Reads: Array<{ Bucket: string; Key: string }>;
  let instrument: { id: string; stockCode: string };
  let runId: string;

  beforeAll(async () => {
    [pg, redisC] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7.4-alpine').start(),
    ]);
    dataSource = new DataSource({
      type: 'postgres',
      url: pg.getConnectionUri(),
      synchronize: false,
      entities: ALL_ENTITIES,
      migrations: MIGRATIONS,
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
    redis = new IORedis(redisC.getConnectionUrl(), { maxRetriesPerRequest: null });

    s3Reads = [];
    const fakeS3 = {
      send: async (command: { input: { Bucket: string; Key: string } }) => {
        s3Reads.push(command.input);
        return {
          Body: { transformToString: async () => JSON.stringify(TECHNICAL_ARTIFACT) },
        };
      },
    } as unknown as S3Client;

    bus = new InMemoryJobBus();
    readCache = new ReadModelCache(redis, { cache: { readTtlSeconds: 3600 } } as AppConfig);
    analyses = new StockAnalysis(
      bus,
      dataSource.getRepository(entities.TechnicalAnalysis),
      dataSource.getRepository(entities.FundamentalAnalysis),
      dataSource.getRepository(entities.Instrument),
      dataSource.getRepository(entities.PriceBar),
      new AnalysisResultStore(dataSource.getRepository(entities.AnalysisResult)),
      readCache,
      fakeS3,
    );
    analyses.onModuleInit();

    runId = (
      await dataSource.query(
        `INSERT INTO ingestion_runs (kind, adapter, provenance_class, ran_at)
         VALUES ('standard', 'PublicReferenceAdapter', $1, now()) RETURNING id`,
        [ProvenanceClass.Real],
      )
    )[0].id as string;
    const sector = await dataSource.getRepository(entities.Sector).save({
      name: 'Financial Services',
      subsector: 'Banks',
      ingestionRunId: runId,
    });
    const seedInstrument = async (stockCode: string, name: string) => {
      const company = await dataSource.getRepository(entities.Company).save({
        fullName: name,
        board: ListingBoard.Main,
        aliases: [],
        sectorId: sector.id,
        ingestionRunId: runId,
      } as Partial<entities.Company>);
      return dataSource.getRepository(entities.Instrument).save({
        stockCode,
        shortName: name,
        fullName: name,
        companyId: company.id,
        ingestionRunId: runId,
      } as Partial<entities.Instrument>);
    };
    const maybank = await seedInstrument(MAYBANK, 'MAYBANK');
    instrument = { id: maybank.id, stockCode: MAYBANK };
    await seedInstrument(INARI, 'INARI');
    await seedBar('2026-10-08');
  });

  afterAll(async () => {
    await redis?.quit();
    if (dataSource?.isInitialized) await dataSource.destroy();
    await redisC?.stop();
    await pg?.stop();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM technical_analyses');
    await dataSource.query('DELETE FROM fundamental_analyses');
    await dataSource.query(
      `DELETE FROM price_bars WHERE trade_date > '2026-10-08'`,
    );
    await redis.flushdb();
    s3Reads = [];
  });

  async function seedBar(tradeDate: string): Promise<void> {
    await dataSource.getRepository(entities.PriceBar).save({
      instrumentId: instrument.id,
      ingestionRunId: runId,
      tradeDate,
      open: '10.000000',
      high: '10.100000',
      low: '9.900000',
      close: '10.050000',
      volume: '1000000',
    } as Partial<entities.PriceBar>);
  }

  /** Enqueue a TA job on the bus and return its envelope + bull id + matching result. */
  async function enqueueTechnical(): Promise<{
    envelope: JobEnvelope<unknown>;
    jobId: string;
    result: JobResult;
  }> {
    const envelope = buildTechnicalEnvelope(MAYBANK, NOW) as JobEnvelope<unknown>;
    const { jobId } = await bus.enqueue(JobNames.technical, envelope, {
      replaceFinished: true,
    });
    return {
      envelope,
      jobId,
      result: { ...TECHNICAL_RESULT, correlationId: envelope.correlationId },
    };
  }

  const cachedTechnical = async (): Promise<{ status: string } | null> => {
    const raw = await redis.get(ReadModelReads.stockAnalysis(MAYBANK, 'technical').key);
    return raw === null ? null : (JSON.parse(raw) as { status: string });
  };

  const wire = (body: unknown) => JSON.parse(JSON.stringify(body)) as unknown;

  it('pending → ready → stale → failed through one interface, cached read correct throughout', async () => {
    // No row yet: pending, and that envelope is now cached.
    const none = await analyses.status(MAYBANK, 'technical');
    parseOrThrow(StockTechnicalAnalysisResponse, wire(none));
    expect(none).toEqual({
      code: MAYBANK,
      status: 'pending',
      headline: null,
      asOf: null,
      artifact: null,
      artifactPath: null,
      errorMessage: null,
      jobName: 'analyze-technical',
    });
    expect(await cachedTechnical()).toMatchObject({ status: 'pending' });

    const { envelope, jobId, result } = await enqueueTechnical();
    await expect(
      analyses.markPending(JobNames.technical, instrument, {
        correlationId: envelope.correlationId,
        jobId,
      }),
    ).resolves.toBe(true);
    expect(await cachedTechnical()).toBeNull(); // pending announced
    expect((await analyses.status(MAYBANK, 'technical')).status).toBe('pending');

    // Land: the cached pending must not survive.
    await bus.complete(result);
    const ready = await analyses.status(MAYBANK, 'technical');
    parseOrThrow(StockTechnicalAnalysisResponse, wire(ready));
    expect(ready).toEqual({
      code: MAYBANK,
      status: 'ready',
      headline: result.summary.headline,
      asOf: '2026-10-08T18:00:00.000Z',
      artifact: { bucket: result.pointer.bucket, key: result.pointer.key },
      artifactPath: `/stocks/${MAYBANK}/analysis/technical/artifact`,
      errorMessage: null,
      jobName: 'analyze-technical',
    });

    expect(await cachedTechnical()).toMatchObject({ status: 'ready' });

    // A newer EOD bar lands; the ingest's eodIngested sweep drops the cached
    // envelope and the next read caches it promoted to stale.
    await seedBar('2026-10-09');
    await readCache.changed({ kind: 'eodIngested' });
    expect((await analyses.status(MAYBANK, 'technical')).status).toBe('stale');
    expect(await cachedTechnical()).toMatchObject({ status: 'stale' });

    const artifact = await analyses.artifact(MAYBANK, 'technical');
    expect(artifact).not.toHaveProperty('cost');
    expect(artifact).toEqual(
      Object.fromEntries(Object.entries(TECHNICAL_ARTIFACT).filter(([k]) => k !== 'cost')),
    );
    expect(s3Reads).toEqual([{ Bucket: result.pointer.bucket, Key: result.pointer.key }]);

    // Final failure: failed (never promoted to stale), last good result kept.
    await bus.failJob(jobId, { userMessage: 'worker blew up' });
    const failed = await analyses.status(MAYBANK, 'technical');
    parseOrThrow(StockTechnicalAnalysisResponse, wire(failed));
    expect(failed).toMatchObject({
      status: 'failed',
      errorMessage: 'worker blew up',
      headline: result.summary.headline,
      artifact: { bucket: result.pointer.bucket, key: result.pointer.key },
    });

    // FA is a separate row: untouched, still pending.
    const fa = await analyses.status(MAYBANK, 'fundamental');
    parseOrThrow(StockFundamentalAnalysisResponse, wire(fa));
    expect(fa).toMatchObject({ status: 'pending', jobName: 'analyze-fundamental' });
  });

  it('facts-only lands as facts_only and goes stale like ready', async () => {
    const { result } = await enqueueTechnical();
    await bus.complete({
      ...result,
      summary: { ...result.summary, headline: 'facts-only: Grounding check failed.' },
    });
    expect((await analyses.status(MAYBANK, 'technical')).status).toBe('facts_only');
    await seedBar('2026-10-09');
    await readCache.changed({ kind: 'eodIngested' });
    expect((await analyses.status(MAYBANK, 'technical')).status).toBe('stale');
  });

  it('markPending does not overwrite a result the worker already landed for the same job', async () => {
    const first = await enqueueTechnical();
    await bus.complete(first.result); // the worker beat the enqueuer
    await expect(
      analyses.markPending(JobNames.technical, instrument, {
        correlationId: first.envelope.correlationId,
        jobId: first.jobId,
      }),
    ).resolves.toBe(false);
    expect((await analyses.status(MAYBANK, 'technical')).status).toBe('ready');

    // A genuinely new job (forced re-run, fresh correlationId) still resets it.
    const second = await enqueueTechnical();
    await expect(
      analyses.markPending(JobNames.technical, instrument, {
        correlationId: second.envelope.correlationId,
        jobId: second.jobId,
      }),
    ).resolves.toBe(true);
    const row = await analyses.findByInstrumentId(JobNames.technical, instrument.id);
    expect(row).toMatchObject({
      status: StockAnalysisStatus.Pending,
      correlationId: second.envelope.correlationId,
      jobId: second.jobId,
      headline: null,
      artifactKey: null,
    });
    expect((await analyses.status(MAYBANK, 'technical')).status).toBe('pending');
  });

  it('a job that fails before its markPending stays failed (pending is refused)', async () => {
    const first = await enqueueTechnical();
    await bus.complete(first.result);
    bus.setState(first.jobId, 'completed');

    // A forced re-run fails terminally before the enqueuer marks it pending.
    const second = await enqueueTechnical();
    await bus.failJob(second.jobId, { userMessage: 'bad envelope' });
    await expect(
      analyses.markPending(JobNames.technical, instrument, {
        correlationId: second.envelope.correlationId,
        jobId: second.jobId,
      }),
    ).resolves.toBe(false);

    expect(await analyses.status(MAYBANK, 'technical')).toMatchObject({
      status: 'failed',
      errorMessage: 'bad envelope',
      // The last good result is kept, not nulled by a pending write.
      headline: first.result.summary.headline,
    });
  });

  it('a failure of a superseded job does not clobber the newer pending job', async () => {
    const first = await enqueueTechnical();
    // A newer job (fresh correlationId) is marked pending while the first is
    // still queued; then the FIRST job's final failure arrives.
    const second = buildTechnicalEnvelope(MAYBANK, NOW);
    await analyses.markPending(JobNames.technical, instrument, {
      correlationId: second.correlationId,
      jobId: first.jobId,
    });

    await bus.failJob(first.jobId, { userMessage: 'old job died' });

    expect(
      await analyses.findByInstrumentId(JobNames.technical, instrument.id),
    ).toMatchObject({
      status: StockAnalysisStatus.Pending,
      correlationId: second.correlationId,
    });
  });

  it('markPending inserts the first row for a never-analysed instrument', async () => {
    const envelope = buildFundamentalEnvelope(MAYBANK, NOW);
    await expect(
      analyses.markPending(JobNames.fundamental, instrument, {
        correlationId: envelope.correlationId,
        jobId: 'fa-1155-quarterly-2026-10-08T18',
      }),
    ).resolves.toBe(true);
    expect(
      await analyses.findByInstrumentId(JobNames.fundamental, instrument.id),
    ).toMatchObject({ status: StockAnalysisStatus.Pending, correlationId: envelope.correlationId });
    expect(
      await analyses.findByInstrumentId(JobNames.technical, instrument.id),
    ).toBeNull();
  });

  it('404s: outside the KLCI 30, unknown code, no artifact pointer — never cached', async () => {
    await expect(analyses.status(INARI, 'technical')).rejects.toThrow(NotFoundException);
    await expect(analyses.status('9999', 'technical')).rejects.toThrow(NotFoundException);
    await expect(analyses.artifact(INARI, 'technical')).rejects.toThrow(NotFoundException);

    // A pending row has no pointer.
    await analyses.markPending(JobNames.technical, instrument, {
      correlationId: randomUUID(),
      jobId: 'ta-1155-1D-2026-10-08T18',
    });
    await expect(analyses.artifact(MAYBANK, 'technical')).rejects.toThrow(
      NotFoundException,
    );
    expect(s3Reads).toEqual([]);
    expect(await redis.keys('*9999*')).toEqual([]);
  });
});
