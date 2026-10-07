/**
 * Indices + sectors endpoint integration test (spec 05, ticket 05; ADR-0011).
 *
 * Exercises three endpoints against REAL infra (testcontainers Postgres +
 * Redis). The controller/service are wired by hand — `{ provide: DataSource,
 * useValue: dataSource }` — rather than importing `MarketModule`, whose
 * `DataModule` opens its OWN `DATABASE_URL`-driven `DataSource`; spying on
 * this test's own `dataSource` would otherwise assert nothing (the service
 * would never call it). Same `stocks.int.spec.ts` / `movers.int.spec.ts`
 * house pattern.
 *
 *  1. `GET /market/indices` — headline + sector indices, clock selection
 *     (Redis class 3 during hours, UNCONDITIONALLY — pinned by a `query` +
 *     `getRepository` spy; Postgres class 2 outside), provenance, cache-class
 *     behaviour.
 *  2. `GET /market/indices/:id/series` — stored IndexLevel history, range
 *     anchored to the SERIES' OWN latest date (not the wall clock), a
 *     non-UUID or unknown id → 404 (never a 500 from a bad `uuid` cast).
 *  3. `GET /market/sectors` — derived from `/market/indices`, so the two can
 *     never disagree.
 *  4. Adapter-swap posture (separate harness): a fake `LicensedIndexAdapter`
 *     feeds the IDENTICAL read surface with different numbers + `real`
 *     provenance — no consumer change.
 *
 * Seeding strategy: run the real nightly ingest (`EodIngestService`) to
 * populate `MarketIndex` + `IndexLevel` rows via the `SyntheticIndexAdapter`,
 * then pin expectations against what that ingest actually produced.
 */
import { IndicesResponse, IndexSeriesResponse, SectorsResponse, parseOrThrow } from '@tuju/contracts';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import IORedis, { type Redis } from 'ioredis';
import {
  RedisContainer,
  type StartedRedisContainer,
} from '@testcontainers/redis';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

import { ReadCacheService, MARKET_CACHE_PREFIX } from '../cache';
import { REDIS_CLIENT } from '../redis/redis.module';
import {
  AnalysisResult,
  Announcement,
  Company,
  CorporateAction,
  FundamentalsSnapshot,
  IndexLevel,
  IndicatorSnapshot,
  IngestionRun,
  Instrument,
  IpoListing,
  MarketIndex,
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
import { MarketIndexKind, ProvenanceClass } from '../data/entities/enums';
import { InitialSchema1727600000000 } from '../data/migrations/1727600000000-InitialSchema';
import { FreeTierDomainModel1727700000000 } from '../data/migrations/1727700000000-FreeTierDomainModel';
import { ReIngestNaturalKeys1727800000000 } from '../data/migrations/1727800000000-ReIngestNaturalKeys';
import { DisclosureReadModel1727900000000 } from '../data/migrations/1727900000000-DisclosureReadModel';
import { MarketIndexModel1728000000000 } from '../data/migrations/1728000000000-MarketIndexModel';
import { AdaptersModule } from '../data/adapters/adapters.module';
import { INDEX_ADAPTER, type IndexAdapter } from '../data/adapters/adapter.interfaces';
import type { IndexLevelsDto } from '../data/adapters/dto';
import { EodIngestService } from '../ingestion/eod-ingest.service';
import { IngestionRunService } from '../ingestion/ingestion-run.service';
import { ReferenceDataService } from '../ingestion/reference-data.service';
import { IntradayReplayService } from '../ingestion/intraday-replay.service';
import { JobBus } from '../jobbus/job-bus.service';
import { REQUIRES_JOB_KEY } from '../auth/requires-job.decorator';
import { pctChange } from '../stocks/serialisation';

import { MarketController } from './market.controller';
import { MarketService, MARKET_CLOCK } from './market.service';

jest.setTimeout(180_000);

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
  MarketIndex,
  IndexLevel,
  Watchlist,
  WatchlistItem,
];

const MIGRATIONS = [
  InitialSchema1727600000000,
  FreeTierDomainModel1727700000000,
  ReIngestNaturalKeys1727800000000,
  DisclosureReadModel1727900000000,
  MarketIndexModel1728000000000,
];

/** A fixed moment OUTSIDE the 09:00–16:45 MYT window (04:00 MYT). */
const OUTSIDE_HOURS = new Date('2026-01-01T20:00:00Z');
/** A fixed moment INSIDE the window (14:00 MYT). */
const DURING_HOURS = new Date('2026-01-01T06:00:00Z');

let pgContainer: StartedPostgreSqlContainer;
let redisContainer: StartedRedisContainer;
let dataSource: DataSource;
let redis: Redis;
let controller: MarketController;
let clockNow: Date;

describe('Indices + sectors endpoints (integration — testcontainers)', () => {
  beforeAll(async () => {
    [pgContainer, redisContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7.4-alpine').start(),
    ]);

    dataSource = new DataSource({
      type: 'postgres',
      url: pgContainer.getConnectionUri(),
      synchronize: false,
      entities: ALL_ENTITIES,
      migrations: MIGRATIONS,
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    redis = new IORedis(redisContainer.getConnectionUrl(), {
      maxRetriesPerRequest: null,
    });

    await runNightlyIngest(dataSource, redis);

    clockNow = OUTSIDE_HOURS;
    const moduleRef = await Test.createTestingModule({
      controllers: [MarketController],
      providers: [
        { provide: DataSource, useValue: dataSource },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: MARKET_CLOCK, useValue: () => clockNow },
        ReadCacheService,
        MarketService,
      ],
    }).compile();
    controller = moduleRef.get(MarketController);
  });

  afterAll(async () => {
    await redis?.quit();
    if (dataSource?.isInitialized) await dataSource.destroy();
    await redisContainer?.stop();
    await pgContainer?.stop();
  });

  afterEach(async () => {
    await redis.flushdb();
    clockNow = OUTSIDE_HOURS;
  });

  // ─── anonymous posture ─────────────────────────────────────────────────

  it('all three routes are anonymous (no @RequiresJob)', () => {
    for (const method of ['indices', 'indexSeries', 'sectors'] as const) {
      expect(
        Reflect.getMetadata(REQUIRES_JOB_KEY, MarketController.prototype[method]),
      ).toBeUndefined();
    }
  });

  // ─── /market/indices outside hours: stored Postgres ─────────────────────

  it('outside hours: returns headline + sector indices from Postgres, provenance synthetic', async () => {
    const res = await controller.indices();
    // Wire-form check against the contract (ADR-0014): what the SPA receives.
    parseOrThrow(IndicesResponse, JSON.parse(JSON.stringify(res)));
    expect(res.indices.length).toBeGreaterThan(0);

    const headline = res.indices.find((i) => i.kind === MarketIndexKind.Headline);
    expect(headline).toBeDefined();
    expect(headline!.sectorName).toBeNull();
    expect(headline!.level).toBeTruthy();
    expect(headline!.provenance).toBe(ProvenanceClass.Synthetic);

    const sectorIndices = res.indices.filter((i) => i.kind === MarketIndexKind.Sector);
    expect(sectorIndices.length).toBeGreaterThan(0);
    sectorIndices.forEach((si) => expect(si.sectorName).toBeTruthy());
  });

  it("outside hours: pctChange equals pctChange(latest, prev) computed directly from the stored IndexLevel rows", async () => {
    const headlineIndex = await dataSource
      .getRepository(MarketIndex)
      .findOneOrFail({ where: { kind: MarketIndexKind.Headline } });
    // The synthetic backfill has MANY levels (one per trading day, same
    // calendar as the price bars) — NOT just one — so pctChange is a real
    // number from the first ingest, not null.
    const [latest, prev] = await dataSource.getRepository(IndexLevel).find({
      where: { indexId: headlineIndex.id },
      order: { levelDate: 'DESC' },
      take: 2,
    });
    expect(latest).toBeDefined();
    expect(prev).toBeDefined();
    const expected = pctChange(Number(latest!.level), Number(prev!.level));

    const res = await controller.indices();
    const headline = res.indices.find((i) => i.kind === MarketIndexKind.Headline)!;
    expect(headline.level).toBe(latest!.level);
    expect(headline.pctChange).toBeCloseTo(expected!, 6);
  });

  it('outside hours: the response is cached (class 2); a second call hits Redis, not Postgres', async () => {
    const first = await controller.indices();
    const keys = await redis.keys(`${MARKET_CACHE_PREFIX}indices`);
    expect(keys.length).toBe(1);

    const pgSpy = jest.spyOn(dataSource, 'getRepository').mockClear();
    const second = await controller.indices();
    expect(second.indices).toEqual(first.indices);
    expect(pgSpy).not.toHaveBeenCalled();
    pgSpy.mockRestore();
  });

  // ─── /market/indices during hours: Redis class 3, UNCONDITIONAL ─────────

  it('during hours: once the outside-hours cache is warm, indices read Redis-only and reflect the live tick', async () => {
    // Warm the identity-field cache (id/kind/name/sectorName/provenance).
    clockNow = OUTSIDE_HOURS;
    await controller.indices();

    // Write a REAL live tick via the ticket-03 replay (pure + Redis-only).
    clockNow = DURING_HOURS;
    const intraday = new IntradayReplayService(redis);
    await intraday.replayTick(DURING_HOURS);

    const pgSpy = jest.spyOn(dataSource, 'query').mockClear();
    const repoSpy = jest.spyOn(dataSource, 'getRepository').mockClear();

    const res = await controller.indices();
    expect(pgSpy).not.toHaveBeenCalled();
    expect(repoSpy).not.toHaveBeenCalled();

    const headline = res.indices.find((i) => i.kind === MarketIndexKind.Headline);
    expect(headline).toBeDefined();
    const liveRaw = await redis.get(
      IntradayReplayService.indexKey(MarketIndexKind.Headline, null),
    );
    const liveTick = JSON.parse(liveRaw!);
    expect(headline!.level).toBe(liveTick.level);
    expect(headline!.pctChange).toBeCloseTo(liveTick.pctChange, 6);

    pgSpy.mockRestore();
    repoSpy.mockRestore();
  });

  it('during hours with a cold identity cache: returns an empty panel gracefully, Postgres untouched', async () => {
    clockNow = DURING_HOURS;
    const pgSpy = jest.spyOn(dataSource, 'query').mockClear();
    const repoSpy = jest.spyOn(dataSource, 'getRepository').mockClear();

    const res = await controller.indices();
    expect(res.indices).toEqual([]);
    expect(pgSpy).not.toHaveBeenCalled();
    expect(repoSpy).not.toHaveBeenCalled();
    pgSpy.mockRestore();
    repoSpy.mockRestore();
  });

  // ─── /market/indices/:id/series ──────────────────────────────────────────

  it('returns the stored IndexLevel series for the headline index, ordered ASC', async () => {
    const headlineIndex = await dataSource
      .getRepository(MarketIndex)
      .findOneOrFail({ where: { kind: MarketIndexKind.Headline } });

    const res = await controller.indexSeries(headlineIndex.id, undefined);
    // Wire-form check against the contract (ADR-0014): what the SPA receives.
    parseOrThrow(IndexSeriesResponse, JSON.parse(JSON.stringify(res)));
    expect(res.id).toBe(headlineIndex.id);
    expect(res.range).toBe('1y'); // default
    expect(res.points.length).toBeGreaterThan(0);
    expect(res.provenance).toBe(ProvenanceClass.Synthetic);
    for (let i = 1; i < res.points.length; i++) {
      expect(res.points[i]!.levelDate >= res.points[i - 1]!.levelDate).toBe(true);
    }
  });

  it("range is anchored to the SERIES' OWN latest stored date, not the wall clock", async () => {
    const headlineIndex = await dataSource
      .getRepository(MarketIndex)
      .findOneOrFail({ where: { kind: MarketIndexKind.Headline } });

    const allPoints = (await controller.indexSeries(headlineIndex.id, 'all')).points;
    const oneMonthPoints = (await controller.indexSeries(headlineIndex.id, '1m')).points;
    // The synthetic backfill ends well before "today" (real wall-clock time),
    // so a wall-clock anchor would make '1m' empty — it must not be.
    expect(oneMonthPoints.length).toBeGreaterThan(0);
    expect(oneMonthPoints.length).toBeLessThan(allPoints.length);
    const latestDate = allPoints[allPoints.length - 1]!.levelDate;
    expect(oneMonthPoints[oneMonthPoints.length - 1]!.levelDate).toBe(latestDate);
  });

  it('an unknown range drops to the default "1y" (never a 400)', async () => {
    const headlineIndex = await dataSource
      .getRepository(MarketIndex)
      .findOneOrFail({ where: { kind: MarketIndexKind.Headline } });
    const res = await controller.indexSeries(headlineIndex.id, '2y');
    expect(res.range).toBe('1y');
  });

  it('a well-formed but unknown UUID id → NotFoundException, nothing cached', async () => {
    const unknownId = '00000000-0000-0000-0000-000000000000';
    await expect(controller.indexSeries(unknownId, undefined)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const keys = await redis.keys(`${MARKET_CACHE_PREFIX}indices:${unknownId}:*`);
    expect(keys).toHaveLength(0);
  });

  it('a non-UUID-shaped id → NotFoundException (never a 500 from a bad uuid cast)', async () => {
    await expect(controller.indexSeries('not-a-uuid', undefined)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('series reads are cached (class 2); a second call hits Redis', async () => {
    const headlineIndex = await dataSource
      .getRepository(MarketIndex)
      .findOneOrFail({ where: { kind: MarketIndexKind.Headline } });

    const first = await controller.indexSeries(headlineIndex.id, '1y');
    const keys = await redis.keys(`${MARKET_CACHE_PREFIX}indices:${headlineIndex.id}:series:1y`);
    expect(keys).toHaveLength(1);

    const second = await controller.indexSeries(headlineIndex.id, '1y');
    expect(second.points).toEqual(first.points);
  });

  // ─── /market/sectors ──────────────────────────────────────────────────────

  it('outside hours: sectors is exactly the sector subset of /market/indices (same machinery)', async () => {
    const indicesRes = await controller.indices();
    const sectorsRes = await controller.sectors();
    // Wire-form check against the contract (ADR-0014): what the SPA receives.
    parseOrThrow(SectorsResponse, JSON.parse(JSON.stringify(sectorsRes)));

    const expectedSectors = indicesRes.indices
      .filter((i) => i.kind === MarketIndexKind.Sector)
      .map((i) => ({
        indexId: i.id,
        sectorName: i.sectorName,
        level: i.level,
        pctChange: i.pctChange,
        provenance: i.provenance,
      }));
    expect(sectorsRes.sectors).toEqual(expectedSectors);
    expect(sectorsRes.sectors.length).toBeGreaterThan(0);
  });

  it('during hours: sectors also reads Redis-only once warm (derived from /market/indices)', async () => {
    clockNow = OUTSIDE_HOURS;
    await controller.indices(); // warm the identity cache

    clockNow = DURING_HOURS;
    const intraday = new IntradayReplayService(redis);
    await intraday.replayTick(DURING_HOURS);

    const pgSpy = jest.spyOn(dataSource, 'query').mockClear();
    const repoSpy = jest.spyOn(dataSource, 'getRepository').mockClear();
    const res = await controller.sectors();
    expect(pgSpy).not.toHaveBeenCalled();
    expect(repoSpy).not.toHaveBeenCalled();
    expect(res.sectors.length).toBeGreaterThan(0);
    pgSpy.mockRestore();
    repoSpy.mockRestore();
  });
});

// ─── Adapter-swap posture (spec 05, ticket 05 AC) ───────────────────────────

/**
 * Stands in for the production swap: declares `real` provenance and serves
 * fixed, known levels — proving the market-overview read surface is identical
 * regardless of which `IndexAdapter` produced the stored rows (the demo
 * `SyntheticIndexAdapter` vs a licensed feed).
 */
class FakeLicensedIndexAdapter implements IndexAdapter {
  readonly provenanceClass = ProvenanceClass.Real;
  fetchIndexLevels(): Promise<IndexLevelsDto[]> {
    return Promise.resolve([
      {
        kind: MarketIndexKind.Headline,
        sectorName: null,
        name: 'FBM KLCI (licensed)',
        levels: [
          { levelDate: '2026-01-05', level: 1590.42 },
          { levelDate: '2026-01-06', level: 1595.1 },
        ],
      },
      {
        kind: MarketIndexKind.Sector,
        sectorName: 'Financial Services',
        name: 'FBM Financial Services Index (licensed)',
        levels: [
          { levelDate: '2026-01-05', level: 220.0 },
          { levelDate: '2026-01-06', level: 221.5 },
        ],
      },
    ]);
  }
}

describe('Adapter-swap posture: a fake LicensedIndexAdapter feeds the identical read surface', () => {
  let swapPg: StartedPostgreSqlContainer;
  let swapRedisContainer: StartedRedisContainer;
  let swapDataSource: DataSource;
  let swapRedis: Redis;
  let swapController: MarketController;

  beforeAll(async () => {
    [swapPg, swapRedisContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7.4-alpine').start(),
    ]);

    swapDataSource = new DataSource({
      type: 'postgres',
      url: swapPg.getConnectionUri(),
      synchronize: false,
      entities: ALL_ENTITIES,
      migrations: MIGRATIONS,
    });
    await swapDataSource.initialize();
    await swapDataSource.runMigrations();

    swapRedis = new IORedis(swapRedisContainer.getConnectionUrl(), {
      maxRetriesPerRequest: null,
    });

    await runNightlyIngest(swapDataSource, swapRedis, new FakeLicensedIndexAdapter());

    const moduleRef = await Test.createTestingModule({
      controllers: [MarketController],
      providers: [
        { provide: DataSource, useValue: swapDataSource },
        { provide: REDIS_CLIENT, useValue: swapRedis },
        { provide: MARKET_CLOCK, useValue: () => OUTSIDE_HOURS },
        ReadCacheService,
        MarketService,
      ],
    }).compile();
    swapController = moduleRef.get(MarketController);
  });

  afterAll(async () => {
    await swapRedis?.quit();
    if (swapDataSource?.isInitialized) await swapDataSource.destroy();
    await swapRedisContainer?.stop();
    await swapPg?.stop();
  });

  it('/market/indices serves the licensed levels with real provenance — identical consumer, different data', async () => {
    const res = await swapController.indices();
    const headline = res.indices.find((i) => i.kind === MarketIndexKind.Headline);
    expect(headline).toBeDefined();
    expect(headline!.level).toBe('1595.100000');
    expect(headline!.provenance).toBe(ProvenanceClass.Real);
    expect(headline!.pctChange).toBeCloseTo(pctChange(1595.1, 1590.42)!, 6);
  });

  it('/market/indices/:id/series serves the licensed series for the headline index', async () => {
    const headlineIndex = await swapDataSource
      .getRepository(MarketIndex)
      .findOneOrFail({ where: { kind: MarketIndexKind.Headline } });
    const res = await swapController.indexSeries(headlineIndex.id, 'all');
    expect(res.provenance).toBe(ProvenanceClass.Real);
    expect(res.points.map((p) => p.level)).toEqual(['1590.420000', '1595.100000']);
  });

  it('/market/sectors serves the licensed sector level with real provenance', async () => {
    const res = await swapController.sectors();
    const financial = res.sectors.find((s) => s.sectorName === 'Financial Services');
    expect(financial).toBeDefined();
    expect(financial!.level).toBe('221.500000');
    expect(financial!.provenance).toBe(ProvenanceClass.Real);
  });
});

// ─── Fixtures ──────────────────────────────────────────────────────────────

/**
 * Run the nightly ingest (`EodIngestService.runNightly`) against `ds`/`redisClient`
 * to populate `MarketIndex` + `IndexLevel` rows. `indexAdapterOverride` swaps the
 * `INDEX_ADAPTER` binding (adapter-swap posture); every other adapter stays the
 * `AdaptersModule` demo default. Mirrors `ingestion.int.spec.ts`'s harness — no
 * `ConfigModule`/`RedisModule` import (nothing here needs `APP_CONFIG`), DataSource
 * and REDIS_CLIENT are provided directly.
 */
async function runNightlyIngest(
  ds: DataSource,
  redisClient: Redis,
  indexAdapterOverride?: IndexAdapter,
): Promise<void> {
  const builder = Test.createTestingModule({
    imports: [AdaptersModule],
    providers: [
      { provide: DataSource, useValue: ds },
      { provide: REDIS_CLIENT, useValue: redisClient },
      IngestionRunService,
      ReferenceDataService,
      ReadCacheService,
      JobBus,
      EodIngestService,
    ],
  });
  const ingestModule = await (indexAdapterOverride
    ? builder.overrideProvider(INDEX_ADAPTER).useValue(indexAdapterOverride)
    : builder
  ).compile();

  const ingest = ingestModule.get(EodIngestService);
  await ingest.runNightly();
  await ingestModule.close();
}
