/**
 * Screener fields endpoint integration test (spec 03; ticket 03; ADR-0011).
 *
 * Exercises `GET /screener/fields` through the composed ScreenerModule
 * against REAL infra via testcontainers (throwaway Postgres + Redis) — not
 * mocks, because what is decided here is exactly what a mock silently gets
 * wrong: the sector domain read from Postgres name-ordered, the class-2
 * read-through cache under `cache:screener:fields` (one entry, served without
 * re-querying, swept by the same prefix sweep the nightly ingest performs —
 * after which a newly-ingested sector appears), and the anonymous posture
 * (ADR-0005).
 *
 * The vocabulary itself (descriptor list, drift coverage vs the parse layer)
 * is NOT re-proven here — the pure advertisement has its own unit suite
 * (`screener-fields.spec.ts`); this suite pins that what crosses the wire is
 * exactly that pinned list.
 *
 * This is a `.spec.ts` (runs in the default `test` lane per the house
 * pattern) but requires Docker for testcontainers.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

import { ConfigModule } from '../config/config.module';
import { RedisModule, REDIS_CLIENT } from '../redis/redis.module';
import { ReadCacheService, SCREENER_CACHE_PREFIX } from '../cache';
import {
  AnalysisResult,
  Announcement,
  Company,
  CorporateAction,
  FundamentalsSnapshot,
  IndicatorSnapshot,
  IngestionRun,
  Instrument,
  IpoListing,
  NewsArticle,
  NewsArticleTag,
  PriceBar,
  QuarterlyFinancials,
  Sector,
  ShariahStatus,
  SyntheticRun,
  Watchlist,
  WatchlistItem,
} from '../data/entities';
import { ProvenanceClass } from '../data/entities/enums';
import { InitialSchema1727600000000 } from '../data/migrations/1727600000000-InitialSchema';
import { FreeTierDomainModel1727700000000 } from '../data/migrations/1727700000000-FreeTierDomainModel';
import { ReIngestNaturalKeys1727800000000 } from '../data/migrations/1727800000000-ReIngestNaturalKeys';
import { DisclosureReadModel1727900000000 } from '../data/migrations/1727900000000-DisclosureReadModel';
import { IngestionRunService } from '../ingestion/ingestion-run.service';
import { REQUIRES_JOB_KEY } from '../auth/requires-job.decorator';

import {
  SCREENER_FILTER_FIELDS,
  SCREENER_FIELDS_CACHE_KEY,
} from './fields';
import { SCREENER_QUERY, type ScreenerQuery } from './screener-query.interface';
import { ScreenerController } from './screener.controller';
import { ScreenerModule } from './screener.module';
import { ScreenerService } from './screener.service';

jest.setTimeout(180_000);

// Full entity list (mirrors screener-endpoint.int.spec.ts / DataModule) so
// the migrations apply against the complete model.
const ALL_ENTITIES = [
  AnalysisResult,
  IngestionRun,
  SyntheticRun,
  Sector,
  Company,
  Instrument,
  PriceBar,
  QuarterlyFinancials,
  FundamentalsSnapshot,
  IndicatorSnapshot,
  CorporateAction,
  ShariahStatus,
  Announcement,
  NewsArticle,
  NewsArticleTag,
  IpoListing,
  Watchlist,
  WatchlistItem,
];

/**
 * Seeded sectors — inserted deliberately OUT of name order to prove the
 * response is name-ordered, not insertion-ordered.
 */
const SEED_SECTOR_NAMES = [
  'Technology',
  'Energy',
  'Consumer Products & Services',
  'Financial Services',
  'Industrial Products & Services',
] as const;

/** The same names, name-ordered — the response's sector domain order. */
const ORDERED_SECTOR_NAMES = [...SEED_SECTOR_NAMES].sort();

/** A sector ingested AFTER the first response was cached (invalidation test). */
const LATE_SECTOR_NAME = 'Healthcare';

// Module-scope harness state (the helpers below run inside beforeAll).
let pgContainer: StartedPostgreSqlContainer;
let redisContainer: StartedRedisContainer;
let dataSource: DataSource;

describe('Screener fields endpoint (integration — testcontainers)', () => {
  let moduleRef: TestingModule;
  let redis: Redis;

  let controller: ScreenerController;
  let service: ScreenerService;
  let readCache: ReadCacheService;
  let sectorsSpy: jest.SpyInstance;

  beforeAll(async () => {
    pgContainer = await new PostgreSqlContainer('postgres:16-alpine').start();
    redisContainer = await new RedisContainer('redis:7.4-alpine').start();

    dataSource = new DataSource({
      type: 'postgres',
      url: pgContainer.getConnectionUri(),
      synchronize: false,
      entities: ALL_ENTITIES,
      migrations: [
        InitialSchema1727600000000,
        FreeTierDomainModel1727700000000,
        ReIngestNaturalKeys1727800000000,
        DisclosureReadModel1727900000000,
      ],
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    await seedSectors();

    // Boot the REAL ScreenerModule (ConfigModule → env URLs, RedisModule →
    // the shared client, DataModule → its own DataSource against the same
    // container) — the "composes" seam, no schedule/worker bits.
    moduleRef = await bootModule();
    controller = moduleRef.get(ScreenerController);
    service = moduleRef.get(ScreenerService);
    readCache = moduleRef.get(ReadCacheService);
    redis = moduleRef.get<Redis>(REDIS_CLIENT);
    sectorsSpy = jest.spyOn(moduleRef.get<ScreenerQuery>(SCREENER_QUERY), 'sectors');

    // Isolate the keyspace assertion (the first fields call below is the
    // only cache write this suite performs).
    await redis.flushdb();
  });

  afterAll(async () => {
    const envKeys = ['DATABASE_URL', 'REDIS_URL', 'SESSION_SECRET'] as const;
    envKeys.forEach((key) => {
      if (envBackup[key] === undefined) delete process.env[key];
      else process.env[key] = envBackup[key];
    });

    // Grab the module's own DataSource before close, then close the module
    // (quits Redis, closes the TypeORM connection via lifecycle hooks).
    const moduleDs = moduleRef?.get<DataSource>(DataSource);
    await moduleRef?.close();
    if (moduleDs?.isInitialized) await moduleDs.destroy();
    if (dataSource?.isInitialized) await dataSource.destroy();
    await redisContainer?.stop();
    await pgContainer?.stop();
  });

  // --- composition + anonymous posture ---------------------------------------

  it('the fields route composes and is anonymous (no @RequiresJob, ADR-0005)', async () => {
    expect(typeof controller.fields).toBe('function');
    expect(service).toBeInstanceOf(ScreenerService);
    expect(
      Reflect.getMetadata(REQUIRES_JOB_KEY, ScreenerController.prototype.fields),
    ).toBeUndefined();
  });

  // --- the advertised response -------------------------------------------------

  it('advertises the pinned filter vocabulary, the MAIN/ACE board domain, and the sector domain name-ordered from Postgres', async () => {
    const res = await controller.fields();
    expect(res.filters).toEqual(SCREENER_FILTER_FIELDS);
    expect(res.boards).toEqual(['MAIN', 'ACE']);
    expect(res.sectors.map((s) => s.name)).toEqual(ORDERED_SECTOR_NAMES);

    // id + name pairs — the ids ARE the FK ids the sector filter takes.
    const sectorRepo = dataSource.getRepository(Sector);
    for (const option of res.sectors) {
      const sector = await sectorRepo.findOneByOrFail({ id: option.id });
      expect(sector.name).toBe(option.name);
    }
    expect(sectorsSpy).toHaveBeenCalledTimes(1);
  });

  // --- class-2 cache -------------------------------------------------------------

  it('the fields response is class-2 cached: one exact key, served without re-querying', async () => {
    const first = await controller.fields();
    const callsAfterFirst = sectorsSpy.mock.calls.length; // includes the warm call

    const second = await controller.fields();
    expect(second).toEqual(first);
    expect(sectorsSpy.mock.calls.length).toBe(callsAfterFirst);

    // Exactly one screener-prefix key, and it IS the reserved fields key.
    const keys = await redis.keys(`${SCREENER_CACHE_PREFIX}*`);
    expect(keys).toEqual([SCREENER_FIELDS_CACHE_KEY]);
  });

  it('the nightly-ingest prefix sweep invalidates it: a sector ingested after caching appears once swept', async () => {
    // A NEW sector lands in Postgres (the reference ingest writes one).
    await insertSector(LATE_SECTOR_NAME);

    // Class-2 semantics: the cached domain does NOT see it until swept.
    const stale = await controller.fields();
    expect(stale.sectors.map((s) => s.name)).toEqual(ORDERED_SECTOR_NAMES);

    // The SAME prefix sweep the nightly ingest + purge perform post-commit
    // (pinned end-to-end in ingestion.int.spec.ts).
    const deleted = await readCache.invalidatePrefix(SCREENER_CACHE_PREFIX);
    expect(deleted).toBeGreaterThan(0);

    const fresh = await controller.fields();
    expect(fresh.sectors.map((s) => s.name)).toEqual(
      [...ORDERED_SECTOR_NAMES, LATE_SECTOR_NAME].sort(),
    );
  });
});

// --- fixtures -------------------------------------------------------------------

const envBackup: Record<string, string | undefined> = {};

/** Boot the real ScreenerModule against the testcontainers URLs (env-backed). */
async function bootModule() {
  const env: Record<'DATABASE_URL' | 'REDIS_URL' | 'SESSION_SECRET', string> = {
    DATABASE_URL: pgContainer.getConnectionUri(),
    REDIS_URL: redisContainer.getConnectionUrl(),
    SESSION_SECRET: 'screener-fields-int-spec',
  };
  (Object.keys(env) as (keyof typeof env)[]).forEach((key) => {
    envBackup[key] = process.env[key];
    process.env[key] = env[key];
  });

  return Test.createTestingModule({
    imports: [ConfigModule, RedisModule, ScreenerModule],
  }).compile();
}

/** The sector reference rows ride one real public-reference ingestion run. */
async function seedSectors(): Promise<void> {
  const runs = new IngestionRunService();
  const realRun = await runs.openRun(
    dataSource.manager,
    'ScreenerFieldsSeedReferenceAdapter',
    ProvenanceClass.Real,
  );
  for (const name of SEED_SECTOR_NAMES) {
    await insertSector(name, realRun.id);
  }
}

/** Insert one sector reference row (the reference run unless given another). */
async function insertSector(name: string, ingestionRunId?: string): Promise<void> {
  const sectorRepo = dataSource.getRepository(Sector);
  let runId = ingestionRunId;
  if (runId === undefined) {
    const runs = new IngestionRunService();
    const realRun = await runs.openRun(
      dataSource.manager,
      'ScreenerFieldsSeedLateReferenceAdapter',
      ProvenanceClass.Real,
    );
    runId = realRun.id;
  }
  await sectorRepo.save(
    sectorRepo.create({ name, subsector: null, ingestionRunId: runId }),
  );
}
