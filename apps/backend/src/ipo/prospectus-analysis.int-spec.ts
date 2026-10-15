/**
 * Prospectus at-a-glance integration test (spec 06, ticket 05; ADR-0011).
 *
 * REAL infra via testcontainers (throwaway Postgres + Redis + LocalStack S3);
 * the Python worker is stood in for by a BullMQ `Worker` returning the
 * committed golden `job-result-prospectus.json` (same prior art as
 * `market-brief.int.spec.ts`). Services are constructed directly against the
 * real connections.
 *
 *   1. `GET /ipo/:id/reference`: EXACT worker-facing shape, Shariah mapping
 *      (latest status wins; none ⇒ null), 404 for unknown/malformed id and for
 *      an IPO with no `prospectusS3Key`.
 *   2. `GET /ipo/:id/at-a-glance` 404s before an analysis lands.
 *   3. JobBus → `ProspectusAnalysisStore`: the golden result persists the thin
 *      row (prospectusId recovered from the colon-form `JobResult.jobId`, while
 *      the BullMQ dedup id is the hyphen form); a re-run upserts in place.
 *   4. `GET /ipo/:id/at-a-glance` returns listing ⋈ thin row; class-2 cache is
 *      cache-through and the store self-invalidates (prefix NOT in the
 *      nightly-swept set).
 *   5. `GET /ipo/:id/at-a-glance/artifact` proxies the S3 object (ADR-0004 §4).
 */
import 'reflect-metadata';
import {
  ProspectusArtifact,
  ProspectusAtAGlanceResponse,
  parseOrThrow,
} from '@tuju/contracts';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import IORedis, { type Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { Worker } from 'bullmq';
import {
  CreateBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import type { JobEnvelope, JobResult, ProspectusPayload } from '@tuju/contracts';

import * as entities from '../data/entities';
import {
  ListingBoard,
  ProvenanceClass,
  ShariahComplianceStatus,
} from '../data/entities/enums';
import { InitialSchema1727600000000 } from '../data/migrations/1727600000000-InitialSchema';
import { FreeTierDomainModel1727700000000 } from '../data/migrations/1727700000000-FreeTierDomainModel';
import { ReIngestNaturalKeys1727800000000 } from '../data/migrations/1727800000000-ReIngestNaturalKeys';
import { DisclosureReadModel1727900000000 } from '../data/migrations/1727900000000-DisclosureReadModel';
import { MarketIndexModel1728000000000 } from '../data/migrations/1728000000000-MarketIndexModel';
import { ShowcaseJobsModel1728100000000 } from '../data/migrations/1728100000000-ShowcaseJobsModel';
import { ProspectusAnalysis1728200000000 } from '../data/migrations/1728200000000-ProspectusAnalysis';
import { BullMqJobBus } from '../jobbus/bullmq-job-bus';
import { ANALYSIS_QUEUE, JobNames } from '../jobbus/job-names';
import { ReadModelCache, DEFAULT_READ_CACHE_TTL_SECONDS } from '../cache/read-model-cache';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PROSPECTUS_CACHE_PREFIX } from '../cache/cache-keys';
import { invalidationPrefixesFor } from '../cache/read-model-changes';
import { IpoController } from './ipo.controller';
import { IpoService } from './ipo.service';
import { ProspectusAnalysisStore } from './prospectus-analysis.store';

jest.setTimeout(240_000);

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

const ALL_ENTITIES = Object.values(entities).filter((v) => typeof v === 'function');

const GOLDEN = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../../packages/contracts/fixtures/job-result-prospectus.json'),
    'utf-8',
  ),
) as JobResult;
const GOLDEN_ID = GOLDEN.jobId.replace('prospectus:', '');

const BUCKET = 'tuju-artifacts';

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 8000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('Prospectus at-a-glance (integration — testcontainers)', () => {
  let pg: StartedPostgreSqlContainer;
  let redisC: StartedRedisContainer;
  let localstack: StartedTestContainer;
  let dataSource: DataSource;
  let redis: Redis;
  let s3: S3Client;
  let jobBus: BullMqJobBus;
  let store: ProspectusAnalysisStore;
  let controller: IpoController;
  let readCache: ReadModelCache;

  let realRunId: string;
  let noPdfId: string;

  beforeAll(async () => {
    [pg, redisC, localstack] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7.4-alpine').start(),
      new GenericContainer('localstack/localstack:3')
        .withEnvironment({ SERVICES: 's3' })
        .withExposedPorts(4566)
        .withWaitStrategy(Wait.forHttp('/_localstack/health', 4566))
        .start(),
    ]);
    s3 = new S3Client({
      region: 'ap-southeast-1',
      endpoint: `http://${localstack.getHost()}:${localstack.getMappedPort(4566)}`,
      forcePathStyle: true,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));

    dataSource = new DataSource({
      type: 'postgres',
      url: pg.getConnectionUri(),
      synchronize: false,
      entities: ALL_ENTITIES,
      migrations: [
        InitialSchema1727600000000,
        FreeTierDomainModel1727700000000,
        ReIngestNaturalKeys1727800000000,
        DisclosureReadModel1727900000000,
        MarketIndexModel1728000000000,
        ShowcaseJobsModel1728100000000,
        ProspectusAnalysis1728200000000,
      ],
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    redis = new IORedis(redisC.getConnectionUrl(), { maxRetriesPerRequest: null });
    jobBus = new BullMqJobBus(redis);
    await jobBus.onModuleInit();
    readCache = new ReadModelCache(redis, fakeConfig());
    store = new ProspectusAnalysisStore(
      jobBus,
      readCache,
      dataSource.getRepository(entities.ProspectusAnalysis),
    );
    store.onModuleInit();
    controller = new IpoController(
      new IpoService(
        dataSource.getRepository(entities.ShariahStatus),
        dataSource.getRepository(entities.Company),
        dataSource.getRepository(entities.IpoListing),
        dataSource.getRepository(entities.ProspectusAnalysis),
        s3,
      ),
      readCache,
    );

    const run = await dataSource.query(
      `INSERT INTO ingestion_runs (kind, adapter, provenance_class, ran_at)
       VALUES ('standard', 'CuratedProspectusCorpusAdapter', $1, now()) RETURNING id`,
      [ProvenanceClass.Real],
    );
    realRunId = run[0].id;

    const listings = dataSource.getRepository(entities.IpoListing);
    await listings.save(
      listings.create({
        id: GOLDEN_ID,
        companyName: 'Insights Analytics Berhad',
        board: ListingBoard.Ace,
        listingDate: '2025-10-27',
        offerPrice: '0.360000',
        prospectusS3Key: 'prospectus/iab.pdf',
        ingestionRunId: realRunId,
      }),
    );
    const noPdf = await listings.save(
      listings.create({
        companyName: 'Calendar Only Berhad',
        board: ListingBoard.Main,
        listingDate: null,
        prospectusS3Key: null,
        ingestionRunId: realRunId,
      }),
    );
    noPdfId = noPdf.id;
  });

  afterAll(async () => {
    await jobBus?.onModuleDestroy();
    await redis?.quit();
    if (dataSource?.isInitialized) await dataSource.destroy();
    await Promise.all([redisC?.stop(), pg?.stop(), localstack?.stop()]);
  });

  async function seedShariah(
    companyName: string,
    rows: Array<{ status: ShariahComplianceStatus; effectiveDate: string }>,
  ): Promise<void> {
    const sectors = dataSource.getRepository(entities.Sector);
    const sector = await sectors.save(
      sectors.create({ name: 'Tech', subsector: 'Software', ingestionRunId: realRunId }),
    );
    const companies = dataSource.getRepository(entities.Company);
    const company = await companies.save(
      companies.create({
        fullName: companyName,
        board: ListingBoard.Ace,
        aliases: [],
        sectorId: sector.id,
        ingestionRunId: realRunId,
      }),
    );
    const statuses = dataSource.getRepository(entities.ShariahStatus);
    for (const r of rows) {
      await statuses.save(
        statuses.create({ companyId: company.id, ingestionRunId: realRunId, ...r }),
      );
    }
  }

  it('the prospectus cache prefix is NOT cleared by the nightly ingest or the purge', () => {
    for (const kind of ['eodIngested', 'purged'] as const) {
      expect(invalidationPrefixesFor({ kind })).not.toContain(PROSPECTUS_CACHE_PREFIX);
    }
  });

  it('GET reference: exact worker shape; shariah null when the company has no status row', async () => {
    const ref = await controller.reference(GOLDEN_ID);
    expect(ref).toEqual({
      id: GOLDEN_ID,
      companyName: 'Insights Analytics Berhad',
      board: 'ACE',
      listingDate: '2025-10-27',
      prospectusS3Key: 'prospectus/iab.pdf',
      shariahStatus: null,
    });
    expect(Object.keys(ref).sort()).toEqual(
      ['board', 'companyName', 'id', 'listingDate', 'prospectusS3Key', 'shariahStatus'],
    );
  });

  it('GET reference: shariahStatus is the CURRENT (latest effectiveDate) status, mapped to worker vocabulary', async () => {
    await seedShariah('Insights Analytics Berhad', [
      { status: ShariahComplianceStatus.NonCompliant, effectiveDate: '2024-05-31' },
      { status: ShariahComplianceStatus.Compliant, effectiveDate: '2025-05-30' },
    ]);
    expect((await controller.reference(GOLDEN_ID)).shariahStatus).toBe('compliant');

    await dataSource.getRepository(entities.ShariahStatus).save(
      dataSource.getRepository(entities.ShariahStatus).create({
        companyId: (await dataSource
          .getRepository(entities.Company)
          .findOneByOrFail({ fullName: 'Insights Analytics Berhad' })).id,
        status: ShariahComplianceStatus.NonCompliant,
        effectiveDate: '2025-11-28',
        ingestionRunId: realRunId,
      }),
    );
    expect((await controller.reference(GOLDEN_ID)).shariahStatus).toBe('non-compliant');
  });

  it('GET reference 404s for unknown id, malformed id, and an IPO with no prospectusS3Key', async () => {
    await expect(controller.reference(randomUUID())).rejects.toThrow(NotFoundException);
    await expect(controller.reference('not-a-uuid')).rejects.toThrow(NotFoundException);
    await expect(controller.reference(noPdfId)).rejects.toThrow(NotFoundException);
  });

  it('GET at-a-glance 404s before any analysis has landed (and artifact too)', async () => {
    await expect(controller.atAGlance(GOLDEN_ID)).rejects.toThrow(NotFoundException);
    await expect(controller.artifact(GOLDEN_ID)).rejects.toThrow(NotFoundException);
    await expect(controller.atAGlance(randomUUID())).rejects.toThrow(NotFoundException);
  });

  it('golden JobResult round-trips JobBus → store → GET at-a-glance (listing ⋈ thin row)', async () => {
    const worker = new Worker(ANALYSIS_QUEUE, async (): Promise<JobResult> => GOLDEN, {
      connection: redis,
    });
    try {
      const envelope: JobEnvelope<ProspectusPayload> = {
        correlationId: GOLDEN.correlationId,
        requestedBy: 'system',
        trigger: 'system',
        asOf: GOLDEN.summary.asOf,
        payload: { prospectusId: GOLDEN_ID },
      };
      const { jobId } = await jobBus.enqueue(JobNames.prospectus, envelope);
      // BullMQ dedup id = hyphen form; the worker's JobResult.jobId = colon form.
      expect(jobId).toBe(`prospectus-${GOLDEN_ID}`);
      expect(GOLDEN.jobId).toBe(`prospectus:${GOLDEN_ID}`);

      const row = await waitFor(() =>
        dataSource
          .getRepository(entities.ProspectusAnalysis)
          .findOne({ where: { prospectusId: GOLDEN_ID } }),
      );
      expect(row.headline).toBe(GOLDEN.summary.headline);
      expect(row.asOf.toISOString()).toBe(new Date(GOLDEN.summary.asOf).toISOString());
      expect(row.artifactBucket).toBe(GOLDEN.pointer.bucket);
      expect(row.artifactKey).toBe(GOLDEN.pointer.key);
      expect(row.jobId).toBe(GOLDEN.jobId);
      expect(row.correlationId).toBe(GOLDEN.correlationId);

      // Wire-form check against the contract (ADR-0014): what the SPA receives.
      parseOrThrow(
        ProspectusAtAGlanceResponse,
        JSON.parse(JSON.stringify(await controller.atAGlance(GOLDEN_ID))),
      );
      expect(await controller.atAGlance(GOLDEN_ID)).toEqual({
        prospectusId: GOLDEN_ID,
        companyName: 'Insights Analytics Berhad',
        board: 'ACE',
        listingDate: '2025-10-27',
        offerPrice: '0.360000',
        headline: GOLDEN.summary.headline,
        asOf: new Date(GOLDEN.summary.asOf).toISOString(),
        source: 'real',
        artifact: { bucket: GOLDEN.pointer.bucket, key: GOLDEN.pointer.key },
        artifactPath: `/ipo/${GOLDEN_ID}/at-a-glance/artifact`,
      });
    } finally {
      await worker.close();
    }
  });

  it('unknown listing ids and non-uuid keys write no row', async () => {
    const repo = dataSource.getRepository(entities.ProspectusAnalysis);
    const before = await repo.count();
    const unknownId = randomUUID();
    // FK violation: thrown to the JobBus, which logs it.
    await expect(
      store.land(
        { ...GOLDEN, jobId: `prospectus:${unknownId}` },
        { jobName: JobNames.prospectus, key: unknownId },
      ),
    ).rejects.toThrow();
    await store.land(
      { ...GOLDEN, jobId: 'prospectus:not-a-uuid' },
      { jobName: JobNames.prospectus, key: 'not-a-uuid' },
    );
    expect(await repo.count()).toBe(before);
  });

  it('class-2 cache: at-a-glance is cache-through; a re-run upserts in place and self-invalidates', async () => {
    const repo = dataSource.getRepository(entities.ProspectusAnalysis);
    const primed = await controller.atAGlance(GOLDEN_ID);
    expect((await redis.keys(`${PROSPECTUS_CACHE_PREFIX}*`)).length).toBeGreaterThan(0);

    // Mutate under the cache: the cached response must not see it.
    await repo.update({ prospectusId: GOLDEN_ID }, { headline: 'mutated underneath' });
    expect(await controller.atAGlance(GOLDEN_ID)).toEqual(primed);

    const before = await repo.count();
    await store.land(
      {
        ...GOLDEN,
        correlationId: randomUUID(),
        summary: { headline: 'Re-run headline', asOf: '2026-10-08T02:00:00Z' },
      },
      { jobName: JobNames.prospectus, key: GOLDEN_ID },
    );
    expect(await repo.count()).toBe(before); // upsert in place
    const fresh = await controller.atAGlance(GOLDEN_ID);
    expect(fresh.headline).toBe('Re-run headline');
    expect(fresh.asOf).toBe('2026-10-08T02:00:00.000Z');
  });

  it('GET artifact proxies the S3 object the pointer names (ADR-0004 §4)', async () => {
    // The golden fixture is the contract's own sample artifact (ProspectusArtifact).
    const artifact: unknown = JSON.parse(
      readFileSync(
        resolve(__dirname, '../../../../packages/contracts/fixtures/prospectus-artifact.json'),
        'utf-8',
      ),
    );
    await s3.send(
      new PutObjectCommand({
        Bucket: GOLDEN.pointer.bucket,
        Key: GOLDEN.pointer.key,
        Body: JSON.stringify(artifact),
        ContentType: 'application/json',
      }),
    );
    expect(await controller.artifact(GOLDEN_ID)).toEqual(artifact);
    parseOrThrow(
      ProspectusArtifact,
      JSON.parse(JSON.stringify(await controller.artifact(GOLDEN_ID))),
    );
  });
});
