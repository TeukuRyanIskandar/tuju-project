/**
 * Daily market brief integration test (spec 06, ticket 02; ADR-0011).
 *
 * Exercises the externally-observable round trip against REAL infra via
 * testcontainers (throwaway Postgres + Redis): a `generate-market-brief`
 * `JobResult` (the Python worker's shape — a real BullMQ `Worker` stand-in
 * here, same prior art as `job-bus.int-spec.ts`) flows through the JobBus,
 * `MarketBriefStore` persists it as the Postgres index-of-record (ADR-0004
 * §4), and the anonymous `GET /market-brief/latest` controller reads it back.
 * Services are constructed directly against the real Redis/Postgres
 * connections (not via Nest's DI container) — same posture as
 * `job-bus.int-spec.ts`.
 *
 *   1. A content-derived BullMQ job id, date-bucketed (`JobBus.deriveJobId`,
 *      ADR-0007 §2) — a same-day re-enqueue would collapse, not duplicate.
 *   2. The persisted row upserts on `briefDate`: a second result for the same
 *      day updates the row in place rather than accumulating rows.
 *   3. `GET /market-brief/latest` serves the latest day's headline + asOf +
 *      a way to reach the fuller artifact (the claim-check pointer).
 *   4. No brief yet → 404 (never a 500 on an empty table).
 */

import { MarketBriefResponse, parseOrThrow } from '@tuju/contracts';
import { randomUUID } from 'node:crypto';
import IORedis, { type Redis } from 'ioredis';
import { DataSource, type Repository } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { Worker } from 'bullmq';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import type { JobEnvelope, JobResult, MarketBriefPayload } from '@tuju/contracts';

import { JobBus } from '../jobbus/job-bus.service';
import { ANALYSIS_QUEUE, JobNames } from '../jobbus/job-names';
import { ReadCacheService, DEFAULT_READ_CACHE_TTL_SECONDS } from '../cache/read-cache.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { BRIEF_CACHE_PREFIX } from '../cache/cache-keys';
import { MarketBrief } from '../data/entities/market-brief.entity';
import { InitialSchema1727600000000 } from '../data/migrations/1727600000000-InitialSchema';
import { FreeTierDomainModel1727700000000 } from '../data/migrations/1727700000000-FreeTierDomainModel';
import { ReIngestNaturalKeys1727800000000 } from '../data/migrations/1727800000000-ReIngestNaturalKeys';
import { DisclosureReadModel1727900000000 } from '../data/migrations/1727900000000-DisclosureReadModel';
import { MarketIndexModel1728000000000 } from '../data/migrations/1728000000000-MarketIndexModel';
import { ShowcaseJobsModel1728100000000 } from '../data/migrations/1728100000000-ShowcaseJobsModel';

import { MarketBriefController } from './market-brief.controller';
import { MarketBriefStore } from './market-brief.store';

jest.setTimeout(180_000);

/** Minimal AppConfig for testing. */
function fakeConfig(readTtlSeconds = DEFAULT_READ_CACHE_TTL_SECONDS): AppConfig {
  return {
    nodeEnv: 'test',
    port: 3000,
    databaseUrl: 'postgres://test',
    redisUrl: 'redis://test',
    sessionSecret: 'test-secret',
    corsOrigins: [],
    dataSource: 'synthetic',
    cookie: {
      domain: undefined,
      secure: false,
      sameSite: 'lax',
      maxAgeSeconds: 604800,
    },
    cache: {
      readTtlSeconds,
    },
  };
}

/** A contract-shaped verdict-less `JobResult` — the Python worker's own shape. */
function stubBriefResult(briefDate: string, headline: string): JobResult {
  return {
    correlationId: randomUUID(),
    jobId: `brief:${briefDate}`,
    pointer: {
      bucket: 'tuju-artifacts',
      key: `analysis/brief/${briefDate}.json`,
      sha256: 'a'.repeat(64),
      bytes: 64,
      contentType: 'application/json',
    },
    summary: { headline, asOf: `${briefDate}T20:00:00.000Z` },
    at: new Date().toISOString(),
  };
}

describe('Daily market brief (integration — testcontainers)', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let dataSource: DataSource;
  let redis: Redis;
  let repo: Repository<MarketBrief>;

  let jobBus: JobBus;
  let store: MarketBriefStore;
  let controller: MarketBriefController;

  beforeAll(async () => {
    pgContainer = await new PostgreSqlContainer('postgres:16-alpine').start();
    redisContainer = await new RedisContainer('redis:7.4-alpine').start();

    dataSource = new DataSource({
      type: 'postgres',
      url: pgContainer.getConnectionUri(),
      synchronize: false,
      entities: [MarketBrief],
      migrations: [
        InitialSchema1727600000000,
        FreeTierDomainModel1727700000000,
        ReIngestNaturalKeys1727800000000,
        DisclosureReadModel1727900000000,
        MarketIndexModel1728000000000,
        ShowcaseJobsModel1728100000000,
      ],
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
    repo = dataSource.getRepository(MarketBrief);

    redis = new IORedis(redisContainer.getConnectionUrl(), {
      maxRetriesPerRequest: null,
    });

    jobBus = new JobBus(redis);
    await jobBus.onModuleInit();
    const readCache = new ReadCacheService(redis, fakeConfig());
    store = new MarketBriefStore(jobBus, readCache, repo);
    store.onModuleInit();
    controller = new MarketBriefController(store, readCache);
  });

  afterAll(async () => {
    await jobBus?.onModuleDestroy();
    await redis?.quit();
    if (dataSource?.isInitialized) await dataSource.destroy();
    await redisContainer?.stop();
    await pgContainer?.stop();
  });

  it('GET /market-brief/latest 404s before any brief has landed', async () => {
    await expect(controller.latest()).rejects.toThrow(NotFoundException);
  });

  it('a generate-market-brief JobResult round-trips: JobBus → MarketBriefStore → GET /market-brief/latest', async () => {
    const worker = new Worker(
      ANALYSIS_QUEUE,
      async (): Promise<JobResult> =>
        stubBriefResult(
          '2026-09-29',
          'FBM KLCI (demo) closed higher (+1.23%) on illustrative data.',
        ),
      { connection: redis },
    );

    try {
      const envelope: JobEnvelope<MarketBriefPayload> = {
        correlationId: randomUUID(),
        requestedBy: 'system',
        trigger: 'system',
        asOf: '2026-09-29T20:00:00.000Z',
        payload: {},
      };
      const { jobId } = await jobBus.enqueue(JobNames.marketBrief, envelope);
      // Content-derived + date-bucketed (ADR-0007 §2): not hour-bucketed like TA/FA.
      expect(jobId).toBe('brief-2026-09-29');

      let latest = await store.findLatest();
      for (let i = 0; i < 100 && !latest; i++) {
        await new Promise((r) => setTimeout(r, 50));
        latest = await store.findLatest();
      }

      expect(latest?.briefDate).toBe('2026-09-29');
      expect(latest?.headline).toBe(
        'FBM KLCI (demo) closed higher (+1.23%) on illustrative data.',
      );
      expect(latest?.artifactBucket).toBe('tuju-artifacts');
      expect(latest?.artifactKey).toBe('analysis/brief/2026-09-29.json');

      const response = await controller.latest();
      // Wire-form check against the contract (ADR-0014): what the SPA receives.
      parseOrThrow(MarketBriefResponse, JSON.parse(JSON.stringify(response)));
      expect(response).toEqual({
        briefDate: '2026-09-29',
        headline: 'FBM KLCI (demo) closed higher (+1.23%) on illustrative data.',
        asOf: '2026-09-29T20:00:00.000Z',
        artifact: { bucket: 'tuju-artifacts', key: 'analysis/brief/2026-09-29.json' },
      });
    } finally {
      await worker.close();
    }
  });

  it('a later re-run for the same day upserts the row in place (no duplicate briefs for one day)', async () => {
    const worker = new Worker(
      ANALYSIS_QUEUE,
      async (): Promise<JobResult> =>
        stubBriefResult('2026-09-29', 'Updated headline for the same day.'),
      { connection: redis },
    );

    try {
      const before = await repo.count();

      // A distinct BullMQ job id (bypassing the queue's own dedup) but the
      // worker still computes the SAME content-derived `JobResult.jobId`
      // (`brief:2026-09-29`) — models a legitimate later re-run landing
      // after the first job already completed and was removed from the queue.
      await jobBus.getQueue().add(
        JobNames.marketBrief,
        {
          correlationId: randomUUID(),
          requestedBy: 'system',
          trigger: 'system',
          asOf: '2026-09-29T21:00:00.000Z',
          payload: {},
        },
        { jobId: 'brief-2026-09-29-later-retry' },
      );

      let updated = await store.findLatest();
      for (
        let i = 0;
        i < 100 && updated?.headline !== 'Updated headline for the same day.';
        i++
      ) {
        await new Promise((r) => setTimeout(r, 50));
        updated = await store.findLatest();
      }

      expect(updated?.headline).toBe('Updated headline for the same day.');
      const after = await repo.count();
      expect(after).toBe(before); // upserted in place, not a new row
    } finally {
      await worker.close();
    }
  });

  it('class-2 cache: GET /market-brief/latest is cache-through; MarketBriefStore invalidates on persist (spec 06, ticket 02)', async () => {
    const primed = await controller.latest();
    const cacheKeys = await redis.keys(`${BRIEF_CACHE_PREFIX}*`);
    expect(cacheKeys.length).toBeGreaterThan(0);

    // Mutate Postgres UNDER the cache, bypassing the store — the cached
    // response must not see it (same posture as disclosures.int.spec.ts).
    await repo.update({ briefDate: primed.briefDate }, { headline: 'mutated underneath' });
    expect(await controller.latest()).toEqual(primed);

    // A legitimate new result for a NEW day invalidates the cache (the store
    // is the only writer, and the only one that knows data changed).
    const worker = new Worker(
      ANALYSIS_QUEUE,
      async (): Promise<JobResult> =>
        stubBriefResult('2026-09-30', 'Fresh brief for a new day.'),
      { connection: redis },
    );
    try {
      await jobBus.enqueue(JobNames.marketBrief, {
        correlationId: randomUUID(),
        requestedBy: 'system',
        trigger: 'system',
        asOf: '2026-09-30T20:00:00.000Z',
        payload: {},
      } satisfies JobEnvelope<MarketBriefPayload>);

      let fresh = await controller.latest().catch(() => null);
      for (let i = 0; i < 100 && fresh?.briefDate !== '2026-09-30'; i++) {
        await new Promise((r) => setTimeout(r, 50));
        fresh = await controller.latest().catch(() => null);
      }
      expect(fresh?.briefDate).toBe('2026-09-30');
      expect(fresh?.headline).toBe('Fresh brief for a new day.');
    } finally {
      await worker.close();
    }
  });
});
