/**
 * Movers endpoint integration test (spec 05, ticket 04; ADR-0011).
 *
 * Exercises the movers endpoint's behaviours against REAL infra via
 * testcontainers (throwaway Postgres + Redis) — not mocks, because what is
 * decided here is exactly what a mock silently gets wrong. The controller and
 * service are wired by hand with `{ provide: DataSource, useValue: dataSource }`
 * (the `stocks.int.spec.ts` / `disclosures.int.spec.ts` house pattern) rather
 * than importing `MarketModule`: that module's `DataModule` opens its OWN
 * `DATABASE_URL`-driven `DataSource`, a SEPARATE pool from this test's
 * `dataSource` — spying on the test's own DataSource would silently assert
 * nothing, since the service would never call it.
 *
 *  1. **Outside market hours:** EOD-close fallback is read from Postgres via
 *     one window-queried SQL round trip, sorted per board type
 *     (gainers/losers/actives), LEAP excluded, cached via the class-2
 *     read-through (the WHOLE board per type, independent of `limit`); a
 *     second call (any limit) hits Redis cache, not Postgres.
 *  2. **During market hours:** the precomputed board is read from Redis
 *     only — Postgres is UNCONDITIONALLY untouched (pinned by a `query` spy
 *     on the service's own DataSource).
 *  3. Param resolution: `type` defaults to 'gainers'; unknown type → default;
 *     `limit` clamps; resolved values echoed.
 *  4. Anonymous posture (ADR-0005): no `@RequiresJob` on the movers route.
 *
 * This is a `.spec.ts` (runs in the default `test` lane per the house pattern)
 * but requires Docker for testcontainers.
 */
import { MoversResponse, parseOrThrow } from '@tuju/contracts';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Test, type TestingModule } from '@nestjs/testing';
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
import { ListingBoard, ProvenanceClass } from '../data/entities/enums';
import { InitialSchema1727600000000 } from '../data/migrations/1727600000000-InitialSchema';
import { FreeTierDomainModel1727700000000 } from '../data/migrations/1727700000000-FreeTierDomainModel';
import { ReIngestNaturalKeys1727800000000 } from '../data/migrations/1727800000000-ReIngestNaturalKeys';
import { DisclosureReadModel1727900000000 } from '../data/migrations/1727900000000-DisclosureReadModel';
import { MarketIndexModel1728000000000 } from '../data/migrations/1728000000000-MarketIndexModel';
import { IngestionRunService } from '../ingestion/ingestion-run.service';
import { IntradayReplayService } from '../ingestion/intraday-replay.service';
import { REQUIRES_JOB_KEY } from '../auth/requires-job.decorator';

import { MarketController } from './market.controller';
import { MarketService, MARKET_CLOCK } from './market.service';
import type { MoverRow } from './market.types';

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

/** A fixed moment OUTSIDE the 09:00–16:45 MYT window (04:00 MYT). */
const OUTSIDE_HOURS = new Date('2026-01-01T20:00:00Z');
/** A fixed moment INSIDE the window (14:00 MYT). */
const DURING_HOURS = new Date('2026-01-01T06:00:00Z');

// ─── Module-scope harness ──────────────────────────────────────────────────

let pgContainer: StartedPostgreSqlContainer;
let redisContainer: StartedRedisContainer;
let dataSource: DataSource;
let moduleRef: TestingModule;
let redis: Redis;
let controller: MarketController;
let clockNow: Date;

// ─── Seed data ─────────────────────────────────────────────────────────────

/** Three MAIN instruments + one LEAP instrument (must be excluded). */
const SEED_STOCKS = [
  {
    stockCode: 'M001',
    shortName: 'ALPHA',
    board: ListingBoard.Main,
    // Latest close 10.2, prev 10.0 → +2%
    bars: [{ close: '10.000000', volume: '1000' }, { close: '10.200000', volume: '1500' }],
  },
  {
    stockCode: 'M002',
    shortName: 'BETA',
    board: ListingBoard.Main,
    // Latest close 5.0, prev 6.0 → −16.67%
    bars: [{ close: '6.000000', volume: '3000' }, { close: '5.000000', volume: '2000' }],
  },
  {
    stockCode: 'M003',
    shortName: 'GAMMA',
    board: ListingBoard.Main,
    // Latest close 8.2, prev 8.0 → +2.5%
    bars: [{ close: '8.000000', volume: '2000' }, { close: '8.200000', volume: '5000' }],
  },
  {
    stockCode: 'L001',
    shortName: 'DELTA',
    board: ListingBoard.Leap,
    // Huge mover + volume — must NEVER appear (outside the analysed universe).
    bars: [{ close: '1.000000', volume: '9000' }, { close: '2.000000', volume: '9000' }],
  },
] as const;

describe('Movers endpoint (integration — testcontainers)', () => {
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
      migrations: [
        InitialSchema1727600000000,
        FreeTierDomainModel1727700000000,
        ReIngestNaturalKeys1727800000000,
        DisclosureReadModel1727900000000,
        MarketIndexModel1728000000000,
      ],
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
    await seedUniverse();

    redis = new IORedis(redisContainer.getConnectionUrl(), {
      maxRetriesPerRequest: null,
    });

    clockNow = OUTSIDE_HOURS;
    moduleRef = await Test.createTestingModule({
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
    await moduleRef?.close();
    if (dataSource?.isInitialized) await dataSource.destroy();
    await redisContainer?.stop();
    await pgContainer?.stop();
  });

  afterEach(async () => {
    await redis.flushdb();
    clockNow = OUTSIDE_HOURS;
  });

  // ─── anonymous posture ────────────────────────────────────────────────────

  it('the movers route is anonymous (no @RequiresJob)', () => {
    expect(
      Reflect.getMetadata(REQUIRES_JOB_KEY, MarketController.prototype.movers),
    ).toBeUndefined();
  });

  // ─── outside market hours: EOD fallback ──────────────────────────────────

  it('outside market hours: gainers orders by %change desc, null last, LEAP excluded', async () => {
    const res = await controller.movers({ type: 'gainers', limit: '10' });
    // Wire-form check against the contract (ADR-0014): what the SPA receives.
    parseOrThrow(MoversResponse, JSON.parse(JSON.stringify(res)));
    expect(res.type).toBe('gainers');
    expect(res.limit).toBe(10);
    // GAMMA +2.5%, ALPHA +2%, BETA −16.67% — L001 (LEAP) never appears.
    expect(res.rows.map((r: MoverRow) => r.stockCode)).toEqual(['M003', 'M001', 'M002']);
    expect(res.rows[0]!.pctChange).toBeCloseTo(2.5, 1);
    expect(res.rows[1]!.pctChange).toBeCloseTo(2.0, 1);
    expect(res.rows[2]!.pctChange).toBeCloseTo(-16.67, 1);
  });

  it('outside market hours: EOD rows carry the PRICE data\'s provenance (synthetic), not the instrument\'s (real)', async () => {
    const res = await controller.movers({ type: 'gainers', limit: '10' });
    for (const row of res.rows) {
      expect(row.provenance).toBe(ProvenanceClass.Synthetic);
    }
  });

  it('outside market hours: losers orders by %change asc', async () => {
    const res = await controller.movers({ type: 'losers', limit: '10' });
    expect(res.rows.map((r: MoverRow) => r.stockCode)).toEqual(['M002', 'M001', 'M003']);
  });

  it('outside market hours: actives orders by volume desc', async () => {
    const res = await controller.movers({ type: 'actives', limit: '10' });
    // volumes: M003=5000, M002=2000, M001=1500 (L001=9000 excluded — LEAP).
    expect(res.rows.map((r: MoverRow) => r.stockCode)).toEqual(['M003', 'M002', 'M001']);
  });

  it('outside market hours: limit slice works (limit=2 → top 2 gainers)', async () => {
    const res = await controller.movers({ type: 'gainers', limit: '2' });
    expect(res.rows).toHaveLength(2);
    expect(res.limit).toBe(2);
    expect(res.rows[0]!.stockCode).toBe('M003');
    expect(res.rows[1]!.stockCode).toBe('M001');
  });

  it('outside market hours: EOD fallback caches the WHOLE board per type — different limits share one cache entry', async () => {
    const first = await controller.movers({ type: 'gainers', limit: '3' });
    const keys = await redis.keys(`${MARKET_CACHE_PREFIX}movers:eod:gainers*`);
    expect(keys).toHaveLength(1);

    const pgSpy = jest.spyOn(dataSource, 'query').mockClear();
    // A DIFFERENT limit for the same type must still be a pure cache slice.
    const second = await controller.movers({ type: 'gainers', limit: '1' });
    expect(second.rows).toEqual(first.rows.slice(0, 1));
    expect(pgSpy).not.toHaveBeenCalled();
    pgSpy.mockRestore();
  });

  it('outside market hours: a cache hit serves the board unchanged after a DB mutation (class 2)', async () => {
    await controller.movers({ type: 'losers', limit: '10' });
    // Mutate the DB after the board is cached.
    const alpha = await dataSource
      .getRepository(Instrument)
      .findOneOrFail({ where: { stockCode: 'M001' } });
    await dataSource.getRepository(PriceBar).update(
      { instrumentId: alpha.id, tradeDate: '2025-12-31' },
      { close: '0.010000' }, // would make ALPHA the biggest loser if re-queried
    );

    const second = await controller.movers({ type: 'losers', limit: '10' });
    expect(second.rows.map((r: MoverRow) => r.stockCode)).toEqual(['M002', 'M001', 'M003']);

    // Restore for subsequent tests.
    await dataSource.getRepository(PriceBar).update(
      { instrumentId: alpha.id, tradeDate: '2025-12-31' },
      { close: '10.200000' },
    );
    await redis.flushdb();
  });

  // ─── during market hours: Redis class 3 ──────────────────────────────────

  it('during market hours: reads from the precomputed Redis board, Postgres UNCONDITIONALLY untouched', async () => {
    clockNow = DURING_HOURS;

    const syntheticBoard = [
      { stockCode: 'M003', shortName: 'GAMMA', price: '8.250000', pctChange: 3.125, volume: 5000 },
      { stockCode: 'M001', shortName: 'ALPHA', price: '10.250000', pctChange: 2.5, volume: 1500 },
    ];
    await redis.set(
      IntradayReplayService.moversKey('gainers'),
      JSON.stringify(syntheticBoard),
      'EX',
      900,
    );

    const pgSpy = jest.spyOn(dataSource, 'query').mockClear();
    const repoSpy = jest.spyOn(dataSource, 'getRepository');

    const res = await controller.movers({ type: 'gainers', limit: '10' });
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]!.stockCode).toBe('M003');
    expect(res.rows[0]!.provenance).toBe(ProvenanceClass.Synthetic);
    expect(pgSpy).not.toHaveBeenCalled();
    expect(repoSpy).not.toHaveBeenCalled();
    pgSpy.mockRestore();
    repoSpy.mockRestore();
  });

  it('during market hours with no Redis board: returns empty rows gracefully, Postgres untouched', async () => {
    clockNow = DURING_HOURS;
    const pgSpy = jest.spyOn(dataSource, 'query').mockClear();

    const res = await controller.movers({ type: 'actives', limit: '5' });
    expect(res.rows).toEqual([]);
    expect(res.type).toBe('actives');
    expect(pgSpy).not.toHaveBeenCalled();
    pgSpy.mockRestore();
  });

  // ─── param resolution ────────────────────────────────────────────────────

  it('unknown type drops to "gainers" default (echoed)', async () => {
    const res = await controller.movers({ type: 'unknown', limit: '5' });
    expect(res.type).toBe('gainers');
  });

  it('limit clamp: over-limit clamps to 50 (echoed)', async () => {
    const res = await controller.movers({ type: 'gainers', limit: '999' });
    expect(res.limit).toBe(50);
  });
});

// ─── Fixtures ──────────────────────────────────────────────────────────────

async function seedUniverse() {
  const runSvc = new IngestionRunService();
  const realRun = await runSvc.openRun(
    dataSource.manager,
    'MoversIntSpecRealAdapter',
    ProvenanceClass.Real,
  );
  const synthRun = await runSvc.openRun(
    dataSource.manager,
    'MoversIntSpecSyntheticAdapter',
    ProvenanceClass.Synthetic,
  );

  const sectorRepo = dataSource.getRepository(Sector);
  const sector = await sectorRepo.save(
    sectorRepo.create({ name: 'Technology', subsector: null, ingestionRunId: realRun.id }),
  );

  const companyRepo = dataSource.getRepository(Company);
  const instrumentRepo = dataSource.getRepository(Instrument);
  const barRepo = dataSource.getRepository(PriceBar);

  const baseDates = ['2025-12-30', '2025-12-31'];

  for (const stock of SEED_STOCKS) {
    const company = await companyRepo.save(
      companyRepo.create({
        fullName: `${stock.shortName} Berhad`,
        board: stock.board,
        aliases: [],
        sectorId: sector.id,
        ingestionRunId: realRun.id,
      }),
    );
    const instrument = await instrumentRepo.save(
      instrumentRepo.create({
        stockCode: stock.stockCode,
        shortName: stock.shortName,
        fullName: `${stock.shortName} Berhad`,
        companyId: company.id,
        ingestionRunId: realRun.id,
      }),
    );
    await barRepo.save(
      stock.bars.map((bar, i) =>
        barRepo.create({
          instrumentId: instrument.id,
          tradeDate: baseDates[i]!,
          open: bar.close,
          high: bar.close,
          low: bar.close,
          close: bar.close,
          volume: bar.volume,
          ingestionRunId: synthRun.id,
        }),
      ),
    );
  }
}
