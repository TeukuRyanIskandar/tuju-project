/**
 * JobBus + sole-writer integration test (ADR-0011).
 *
 * The two highest-value backend seams exercised against REAL infra via
 * testcontainers (throwaway Redis + Postgres, the same stack ADR-0006 runs in
 * compose) — not mocks, because the decided behaviors here (ADR-0007 BullMQ
 * round-trip over real Redis + Lua, ADR-0004 sole-writer Postgres transaction)
 * are exactly what a mock silently gets wrong:
 *
 *   1. JobBus enqueue → a real BullMQ Worker processes → result hands back over
 *      the queue and JobBus.onResult fires (ADR-0001/0007 §7).
 *   2. The AnalysisResultStore — the REAL production writer — persists that
 *      result into Postgres as the sole writer and reads it back by
 *      correlationId (ADR-0004 §2/§4). The test drives the actual service, not a
 *      raw repository, so the sole-writer code path itself is under test.
 *
 * This is a `.int-spec.ts` file, EXCLUDED from the unit lane (jest.config.cjs
 * testPathIgnorePatterns) so the unit layer never needs Docker. It runs only in
 * the CI integration lane via jest.int.config.cjs.
 */
import { randomUUID } from 'node:crypto';
import { Worker } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { DataSource, type Repository } from 'typeorm';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import type { JobEnvelope, JobResult } from '@tuju/contracts';
import { isVerdictSummary } from './job-result-helpers';
import { JobBus } from './job-bus.service';
import { ANALYSIS_QUEUE, STUB_JOB_NAME } from './job-names';
import { AnalysisResultStore } from '../analysis/analysis-result.store';
import { AnalysisResult } from '../data/entities/analysis-result.entity';
import { InitialSchema1727600000000 } from '../data/migrations/1727600000000-InitialSchema';

// Containers are slow to pull/boot; give Jest room beyond its 5s default.
jest.setTimeout(120_000);

/** A contract-shaped JobResult stub for a given correlation id (ADR-0007 §5). */
function stubResult(correlationId: string, symbol = 'MAYBANK'): JobResult {
  return {
    correlationId,
    jobId: `technical:${symbol}:1D:2026-09-29T05`,
    pointer: {
      bucket: 'tuju-artifacts',
      key: `analysis/ta/${symbol}/2026-09-29T05.json`,
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

describe('JobBus (integration — testcontainers)', () => {
  let redisContainer: StartedRedisContainer;
  let pgContainer: StartedPostgreSqlContainer;
  let redis: Redis;
  let dataSource: DataSource;
  let repo: Repository<AnalysisResult>;

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
      entities: [AnalysisResult],
      migrations: [InitialSchema1727600000000],
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
    repo = dataSource.getRepository(AnalysisResult);
  });

  afterAll(async () => {
    await redis?.quit();
    if (dataSource?.isInitialized) await dataSource.destroy();
    await redisContainer?.stop();
    await pgContainer?.stop();
  });

  it('round-trips a stub job (enqueue → process → result) against real Redis', async () => {
    const jobBus = new JobBus(redis);
    await jobBus.onModuleInit();

    const received = new Promise<JobResult>((resolve) => {
      jobBus.onResult((r) => resolve(r));
    });

    // A real worker consumes the analysis queue and returns a JobResult-shaped
    // value (the Python worker's contract; here a minimal stand-in producer).
    const correlationId = randomUUID();
    const worker = new Worker(
      ANALYSIS_QUEUE,
      async (job): Promise<JobResult> => stubResult(job.data.correlationId),
      { connection: redis },
    );

    try {
      const envelope: JobEnvelope<{ symbol: string; timeframe: string }> = {
        correlationId,
        asOf: '2026-09-29T05:00:00.000Z',
        payload: { symbol: 'MAYBANK', timeframe: '1D' },
      } as JobEnvelope<{ symbol: string; timeframe: string }>;

      const { jobId } = await jobBus.enqueue(STUB_JOB_NAME, envelope);
      expect(jobId).toMatch(/^ta:MAYBANK:1D:/);

      const result = await received;
      expect(result.correlationId).toBe(correlationId);
      if (!isVerdictSummary(result.summary)) throw new Error('expected a verdict-bearing summary');
      expect(result.summary.verdict).toBe('bullish');
      expect(result.pointer.bucket).toBe('tuju-artifacts');
    } finally {
      await worker.close();
      await jobBus.onModuleDestroy();
    }
  });

  it('persists via the real AnalysisResultStore as the sole writer and reads it back (ADR-0004)', async () => {
    // Drive the ACTUAL production writer through a FULL round-trip: a real
    // Worker returns a JobResult → JobBus 'completed' → AnalysisResultStore
    // (subscribed via onResult) persists it → we read it back through the
    // store's own read path. No mocks and no private-state pokes: the real
    // sole-writer code path (ADR-0004 §2) is exercised end to end.
    const jobBus = new JobBus(redis);
    await jobBus.onModuleInit();
    const store = new AnalysisResultStore(jobBus, repo);
    store.onModuleInit(); // wires store.persist into jobBus.onResult

    const correlationId = randomUUID();
    // A distinct symbol so the content-derived BullMQ jobId (ADR-0007 §2)
    // differs from the first test's — otherwise BullMQ would dedupe the two
    // jobs and this one would never reprocess.
    const symbol = 'SOLEWRITER';
    const worker = new Worker(
      ANALYSIS_QUEUE,
      async (job): Promise<JobResult> => stubResult(job.data.correlationId, symbol),
      { connection: redis },
    );

    try {
      const envelope: JobEnvelope<{ symbol: string; timeframe: string }> = {
        correlationId,
        asOf: '2026-09-29T05:00:00.000Z',
        payload: { symbol, timeframe: '1D' },
      } as JobEnvelope<{ symbol: string; timeframe: string }>;

      await jobBus.enqueue(STUB_JOB_NAME, envelope);

      // The persist is async off the 'completed' event; poll the store's read
      // path until the sole-writer row lands.
      let found: AnalysisResult | null = null;
      for (let i = 0; i < 100 && !found; i++) {
        found = await store.findByCorrelationId(correlationId);
        if (!found) await new Promise((r) => setTimeout(r, 50));
      }

      expect(found).not.toBeNull();
      expect(found?.symbol).toBe(symbol);
      expect(found?.verdict).toBe('bullish');
      expect(found?.id).toBeDefined();
      expect(found?.createdAt).toBeInstanceOf(Date);
    } finally {
      await worker.close();
      await jobBus.onModuleDestroy();
    }
  });
});
