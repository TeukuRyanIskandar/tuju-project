/**
 * JobBus + sole-writer integration test (ADR-0011).
 *
 * The highest-value backend seams exercised against REAL infra via
 * testcontainers (throwaway Redis + Postgres, the same stack ADR-0006 runs in
 * compose) — not mocks, because the decided behaviors here (ADR-0007 BullMQ
 * round-trip over real Redis + Lua, BullMQ's custom-id rules, ADR-0004
 * sole-writer Postgres transaction) are exactly what a mock silently gets wrong:
 *
 *   1. JobBus enqueue → a real BullMQ Worker processes → result hands back over
 *      the queue and JobBus.onResult fires (ADR-0001/0007 §7).
 *   2. The stock-analysis job family routes a verdict-bearing result to the
 *      REAL `AnalysisResultStore`, which persists it into Postgres as the sole
 *      writer and reads it back by correlationId (ADR-0004 §2/§4).
 *   3. Every job family's bull id is accepted by a real `Queue.add`.
 *   4. In-flight / replace semantics of `enqueue` against real job states.
 *   5. A final failure reaches exactly the failed job's family.
 *
 * This is a `.int-spec.ts` file, EXCLUDED from the unit lane (jest.config.cjs
 * testPathIgnorePatterns) so the unit layer never needs Docker. It runs only in
 * the CI integration lane via jest.int.config.cjs.
 */
import { randomUUID } from 'node:crypto';
import { UnrecoverableError, Worker } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { DataSource, type Repository } from 'typeorm';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import type { S3Client } from '@aws-sdk/client-s3';
import type { JobEnvelope, JobFailure, JobName, JobResult } from '@tuju/contracts';
import * as entities from '../data/entities';
import { BullMqJobBus } from './bullmq-job-bus';
import type { JobFamily, JobRef } from './job-family';
import { marketBriefIdentity, resultIdFor } from './job-identities';
import { ANALYSIS_QUEUE, JobNames } from './job-names';
import { AnalysisResultStore } from '../analysis/analysis-result.store';
import { StockAnalysis } from '../analysis/stock-analysis';
import { ReadModelCache } from '../cache/read-model-cache';
import type { AppConfig } from '../config/config';
import { AnalysisResult } from '../data/entities/analysis-result.entity';
import { InitialSchema1727600000000 } from '../data/migrations/1727600000000-InitialSchema';

// Containers are slow to pull/boot; give Jest room beyond its 5s default.
jest.setTimeout(120_000);

const ALL_ENTITIES = Object.values(entities).filter((v) => typeof v === 'function');

/** A contract-shaped verdict-bearing JobResult answering a job (ADR-0007 §5). */
function stubResult(jobName: string, env: JobEnvelope<{ symbol: string }>): JobResult {
  return {
    correlationId: env.correlationId,
    jobId: resultIdFor(jobName as JobName, env),
    pointer: {
      bucket: 'tuju-artifacts',
      key: `analysis/ta/${env.payload.symbol}/2026-09-29T05.json`,
      sha256: 'a'.repeat(64),
      bytes: 128,
      contentType: 'application/json',
    },
    summary: {
      verdict: 'bullish',
      headline: 'stub round-trip',
      asOf: '2026-09-29T05:00:00.000Z',
    },
    at: new Date().toISOString(),
  };
}

function envelope<P>(asOf: string, payload: P): JobEnvelope<P> {
  return {
    correlationId: randomUUID(),
    requestedBy: 'system',
    trigger: 'system',
    asOf,
    payload,
  };
}

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 8000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('JobBus (integration — testcontainers)', () => {
  let redisContainer: StartedRedisContainer;
  let pgContainer: StartedPostgreSqlContainer;
  let redis: Redis;
  let dataSource: DataSource;
  let repo: Repository<AnalysisResult>;
  let jobBus: BullMqJobBus;

  beforeAll(async () => {
    redisContainer = await new RedisContainer('redis:7.4-alpine').start();
    pgContainer = await new PostgreSqlContainer('postgres:16-alpine').start();

    redis = new IORedis(redisContainer.getConnectionUrl(), {
      maxRetriesPerRequest: null,
    });

    dataSource = new DataSource({
      type: 'postgres',
      url: pgContainer.getConnectionUri(),
      synchronize: false,
      // All entity metadata (the stock-analysis family's repositories need
      // it); only `analysis_results` is queried, so one migration suffices.
      entities: ALL_ENTITIES,
      migrations: [InitialSchema1727600000000],
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
    repo = dataSource.getRepository(AnalysisResult);

    jobBus = new BullMqJobBus(redis);
    await jobBus.onModuleInit();
    new StockAnalysis(
      jobBus,
      dataSource.getRepository(entities.TechnicalAnalysis),
      dataSource.getRepository(entities.FundamentalAnalysis),
      dataSource.getRepository(entities.Instrument),
      dataSource.getRepository(entities.PriceBar),
      new AnalysisResultStore(repo),
      new ReadModelCache(redis, { cache: { readTtlSeconds: 60 } } as AppConfig),
      {} as S3Client, // never read here
    ).onModuleInit(); // registers the family with the bus
  });

  afterAll(async () => {
    await jobBus?.onModuleDestroy();
    await redis?.quit();
    if (dataSource?.isInitialized) await dataSource.destroy();
    await redisContainer?.stop();
    await pgContainer?.stop();
  });

  afterEach(async () => {
    await jobBus.getQueue().obliterate({ force: true });
  });

  it('round-trips a TA job (enqueue → process → result) against real Redis, under a BullMQ-legal id', async () => {
    const received = new Promise<JobResult>((resolve) => {
      jobBus.onResult((r) => resolve(r));
    });
    // A real worker consumes the analysis queue and returns a JobResult-shaped
    // value (the Python worker's contract; here a minimal stand-in producer).
    const worker = new Worker(
      ANALYSIS_QUEUE,
      async (job): Promise<JobResult> => stubResult(job.name, job.data),
      { connection: redis },
    );

    try {
      const env = envelope('2026-09-29T05:00:00.000Z', { symbol: 'MAYBANK', timeframe: '1D' as const });
      const outcome = await jobBus.enqueue(JobNames.technical, env);
      // The hyphen form: BullMQ 5 rejects the old `ta:MAYBANK:1D:…` colon id.
      expect(outcome).toEqual({ jobId: 'ta-MAYBANK-1D-2026-09-29T05', status: 'enqueued' });

      const result = await received;
      expect(result.correlationId).toBe(env.correlationId);
      expect(result.jobId).toBe('technical:MAYBANK:1D:2026-09-29T05');
      expect('verdict' in result.summary && result.summary.verdict).toBe('bullish');
      expect(result.pointer.bucket).toBe('tuju-artifacts');
    } finally {
      await worker.close();
    }
  });

  it('routes a verdict-bearing result to the real AnalysisResultStore as the sole writer (ADR-0004)', async () => {
    // Full round-trip, no mocks, no private-state pokes: a real Worker returns
    // a JobResult → JobBus 'completed' → the stock-analysis family → the
    // AnalysisResultStore persists it → read back through its own read path.
    const symbol = 'SOLEWRITER';
    const worker = new Worker(
      ANALYSIS_QUEUE,
      async (job): Promise<JobResult> => stubResult(job.name, job.data),
      { connection: redis },
    );
    const store = new AnalysisResultStore(repo);

    try {
      const env = envelope('2026-09-29T05:00:00.000Z', { symbol, timeframe: '1D' as const });
      await jobBus.enqueue(JobNames.technical, env);

      const found = await waitFor(() => store.findByCorrelationId(env.correlationId));
      expect(found.symbol).toBe(symbol);
      expect(found.verdict).toBe('bullish');
      expect(found.jobId).toBe(`technical:${symbol}:1D:2026-09-29T05`);
      expect(found.id).toBeDefined();
      expect(found.createdAt).toBeInstanceOf(Date);
    } finally {
      await worker.close();
    }
  });

  it('every job family\'s bull id is accepted by a real Queue.add', async () => {
    const asOf = '2026-10-08T18:00:00.000Z';
    const jobs: Array<[JobName, JobEnvelope<object>, string]> = [
      [JobNames.technical, envelope(asOf, { symbol: '1155', timeframe: '1D' }), 'ta-1155-1D-2026-10-08T18'],
      [JobNames.fundamental, envelope(asOf, { symbol: '1155', period: 'quarterly' }), 'fa-1155-quarterly-2026-10-08T18'],
      [JobNames.marketBrief, envelope(asOf, {}), 'brief-2026-10-08'],
      [JobNames.announcementSummary, envelope(asOf, { announcementId: '42' }), 'ann-42'],
      [JobNames.prospectus, envelope(asOf, { prospectusId: randomUUID() }), 'prospectus-'],
    ];
    for (const [jobName, env, expected] of jobs) {
      const { jobId, status } = await jobBus.enqueue(jobName, env);
      expect(status).toBe('enqueued');
      expect(jobId.startsWith(expected)).toBe(true);
      const stored = await jobBus.getQueue().getJob(jobId);
      expect(stored?.name).toBe(jobName);
      expect(await stored?.getState()).toBe('waiting');
    }
  });

  it('enqueue collapses onto an in-flight job and replaces a finished one only on request', async () => {
    const queue = jobBus.getQueue();
    const env = () => envelope('2026-10-01T20:00:00.000Z', {});

    const first = await jobBus.enqueue(JobNames.marketBrief, env());
    expect(first).toEqual({ jobId: 'brief-2026-10-01', status: 'enqueued' });
    expect(await jobBus.enqueue(JobNames.marketBrief, env(), { replaceFinished: true })).toEqual({
      jobId: 'brief-2026-10-01',
      status: 'inFlight',
    });
    expect(await queue.getJobCountByTypes('waiting')).toBe(1);

    // A real worker completes it; BullMQ retains the completed job (1h).
    const worker = new Worker(ANALYSIS_QUEUE, async () => ({ ok: true }), { connection: redis });
    try {
      await waitFor(async () =>
        (await (await queue.getJob('brief-2026-10-01'))?.getState()) === 'completed' ? true : null,
      );
    } finally {
      await worker.close();
    }

    // Default: the retained job holds the id (the same-day collapse).
    expect((await jobBus.enqueue(JobNames.marketBrief, env())).status).toBe('finished');
    expect(await (await queue.getJob('brief-2026-10-01'))?.getState()).toBe('completed');

    // replaceFinished: removed and re-added, waiting again with the new envelope.
    const rerun = env();
    expect((await jobBus.enqueue(JobNames.marketBrief, rerun, { replaceFinished: true })).status).toBe(
      'enqueued',
    );
    const fresh = await queue.getJob('brief-2026-10-01');
    expect(await fresh?.getState()).toBe('waiting');
    expect(fresh?.data.correlationId).toBe(rerun.correlationId);
  });

  it('a final failure reaches exactly the failed job\'s family, keyed from its envelope', async () => {
    const bus = new BullMqJobBus(redis);
    await bus.onModuleInit();
    const failures: Array<{ failure: JobFailure; ref: JobRef }> = [];
    const briefFamily: JobFamily<'generate-market-brief', string> = {
      identity: marketBriefIdentity,
      land: async () => undefined,
      fail: async (failure, ref) => {
        failures.push({ failure, ref });
      },
    };
    bus.register(briefFamily);

    const worker = new Worker(
      ANALYSIS_QUEUE,
      async () => {
        throw new UnrecoverableError('bad envelope');
      },
      { connection: redis },
    );
    try {
      const env = envelope('2026-10-02T20:00:00.000Z', {});
      await bus.enqueue(JobNames.marketBrief, env);
      const [got] = await waitFor(async () => (failures.length ? failures : null));
      expect(got.ref).toEqual({ jobName: JobNames.marketBrief, key: '2026-10-02' });
      // Routing only: failure classification (this reports
      // `transient_exhausted` even for an UnrecoverableError) is
      // architecture-review ticket 01's, not this one's.
      expect(got.failure).toMatchObject({
        correlationId: env.correlationId,
        jobId: 'brief-2026-10-02',
      });
    } finally {
      await worker.close();
      await bus.onModuleDestroy();
    }
  });
});
