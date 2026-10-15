/**
 * Screener endpoint integration test (spec 03; ticket 02; ADR-0011).
 *
 * Exercises the endpoint's own behaviours through the composed ScreenerModule
 * against REAL infra via testcontainers (throwaway Postgres + Redis) — not
 * mocks, because what is decided here is exactly what a mock silently gets
 * wrong: the class-2 read-through cache keyed by the canonical normalised
 * params (order-rotated and clamped-equivalent requests share one Redis
 * entry; a swept prefix forces a re-query) and the param resolution → seam
 * wiring with the resolved values echoed.
 *
 * Filter/join depth is NOT re-proven here — the read model has its own
 * 32-case suite (`screener.int.spec.ts`, ticket 01). This suite seeds the
 * same hand-controlled universe and proves one representative filter per
 * class SURVIVES the endpoint round-trip, plus the echo, the cache, and the
 * anonymous posture (ADR-0005).
 *
 * This is a `.spec.ts` (runs in the default `test` lane per the house
 * pattern) but requires Docker for testcontainers.
 */
import { ScreenerResponse, parseOrThrow } from '@tuju/contracts';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Test, type TestingModule } from '@nestjs/testing';
import { ScheduleModule } from '@nestjs/schedule';
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
import {
  ListingBoard,
  ProvenanceClass,
  ShariahComplianceStatus,
} from '../data/entities/enums';
import { InitialSchema1727600000000 } from '../data/migrations/1727600000000-InitialSchema';
import { FreeTierDomainModel1727700000000 } from '../data/migrations/1727700000000-FreeTierDomainModel';
import { ReIngestNaturalKeys1727800000000 } from '../data/migrations/1727800000000-ReIngestNaturalKeys';
import { DisclosureReadModel1727900000000 } from '../data/migrations/1727900000000-DisclosureReadModel';
import { IngestionRunService } from '../ingestion/ingestion-run.service';
import { REQUIRES_JOB_KEY } from '../auth/requires-job.decorator';

import { parseScreenerQuery, type RawScreenerParams } from './params';
import {
  SCREENER_QUERY,
  type ScreenerQuery,
} from './screener-query.interface';
import { ScreenerController } from './screener.controller';
import { ScreenerModule } from './screener.module';
import { ScreenerService, screenerCacheKey } from './screener.service';

jest.setTimeout(180_000);

// Full entity list (mirrors screener.int.spec.ts / DataModule) so the
// migrations apply against the complete model.
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

/** Fixed quarter period-ends FY2023Q1 → FY2025Q4 (12 quarters, 3 years). */
const PERIOD_ENDS = [
  '2023-03-31', '2023-06-30', '2023-09-30', '2023-12-31',
  '2024-03-31', '2024-06-30', '2024-09-30', '2024-12-31',
  '2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31',
] as const;

/** Net profit per quarter (FY23Q1 → FY25Q4) for every seeded company. */
const QUARTERLY_PROFITS: Record<string, number[]> = {
  // Growing every quarter from FY24 (YoY defined): consecutive 8, all years profitable.
  '0101': [120, 140, 160, 180, 200, 220, 240, 260, 280, 300, 320, 340],
  // Loss-making every quarter, deepening in FY25Q4 (-150 vs -100).
  '0202': [-80, -80, -80, -80, -90, -90, -90, -90, -100, -100, -100, -150],
  // Flat FY23/24, FY25 growing: YoY latest +20%, all years profitable.
  '0303': [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 120],
  // Profitable FY23/24, FY25 sum negative (latest quarter a loss): YoY latest < 0.
  '0404': [50, 50, 50, 50, 60, 60, 60, 60, 70, 70, -100, -100],
  // Growing every year: YoY latest +25%, consecutive 8.
  '0505': [100, 100, 100, 100, 110, 110, 110, 110, 120, 130, 140, 150],
};

/** Fundamentals-snapshot columns per company (stored, never recomputed). */
const SNAPSHOT_VALUES: Record<
  string,
  Omit<Partial<FundamentalsSnapshot>, 'company' | 'ingestionRun'>
> = {
  '0101': { peRatio: '8.5', dividendYield: '0.04', pntaRatio: '1.1', roe: '0.12', debtToEquity: '0.5', consecutiveGrowthQuarters: 8 },
  '0202': { peRatio: null, dividendYield: null, pntaRatio: '0.9', roe: '-0.05', debtToEquity: '2.0', consecutiveGrowthQuarters: 0 },
  '0303': { peRatio: '15', dividendYield: null, pntaRatio: '2.0', roe: '0.08', debtToEquity: '0.9', consecutiveGrowthQuarters: 3 },
  '0404': { peRatio: '20', dividendYield: null, pntaRatio: '1.5', roe: '0.05', debtToEquity: '0.1', consecutiveGrowthQuarters: 1 },
  '0505': { peRatio: '12', dividendYield: '0.06', pntaRatio: '0.8', roe: '0.15', debtToEquity: '0.2', consecutiveGrowthQuarters: 8 },
};

/** Indicator-snapshot columns per company (latest close matches the latest bar). */
const INDICATOR_VALUES: Record<string, Partial<Pick<IndicatorSnapshot, 'sma20' | 'sma50' | 'sma200' | 'rsi14'>>> = {
  '0101': { sma20: '9.8', sma50: '9.5', sma200: '9.0', rsi14: '55' },
  '0202': { sma20: '5.8', sma50: '6.0', sma200: '6.5', rsi14: '25' },
  // sma50 null: aboveSma50 true AND false must both exclude it.
  '0303': { sma20: '8.0', sma50: null, sma200: '8.5', rsi14: '75' },
  '0404': { sma20: '3.1', sma50: '3.0', sma200: '3.0', rsi14: '50' },
  '0505': { sma20: '4.4', sma50: '4.5', sma200: '4.0', rsi14: '40' },
};

/** Price bars per company: [prevClose, close] — one bar = pctChange null. */
const PRICE_BARS: Record<string, { prev: string | null; close: string; volume: string }> = {
  '0101': { prev: '10.0', close: '10.2', volume: '1000000' },
  '0202': { prev: null, close: '5.0', volume: '500000' },
  '0303': { prev: '8.0', close: '7.9', volume: '2000000' },
  '0404': { prev: '3.0', close: '3.3', volume: '1200000' },
  '0505': { prev: '4.0', close: '4.1', volume: '900000' },
};

interface SeedCompany {
  stockCode: string;
  shortName: string;
  fullName: string;
  board: ListingBoard;
  sectorName: string;
  /** null = no shariah row; else [status, effectiveDate]. */
  shariah?: [ShariahComplianceStatus, string] | null;
}

const SEED_COMPANIES: readonly SeedCompany[] = [
  { stockCode: '0101', shortName: 'PROFIT', fullName: 'Profit Berhad', board: ListingBoard.Main, sectorName: 'Financial Services', shariah: [ShariahComplianceStatus.Compliant, '2024-06-01'] },
  { stockCode: '0202', shortName: 'LOSSCO', fullName: 'Loss Company Berhad', board: ListingBoard.Main, sectorName: 'Technology', shariah: [ShariahComplianceStatus.NonCompliant, '2024-06-01'] },
  { stockCode: '0303', shortName: 'ACECO', fullName: 'Ace Company Berhad', board: ListingBoard.Ace, sectorName: 'Technology', shariah: null },
  { stockCode: '0404', shortName: 'STALECO', fullName: 'Stale Company Berhad', board: ListingBoard.Main, sectorName: 'Consumer Products & Services', shariah: [ShariahComplianceStatus.Compliant, '2024-06-01'] },
  { stockCode: '0505', shortName: 'GROWCO', fullName: 'Grow Company Berhad', board: ListingBoard.Main, sectorName: 'Industrial Products & Services', shariah: [ShariahComplianceStatus.Compliant, '2024-06-01'] },
  // LEAP row: exists in the reference tables, never reaches a screen.
  { stockCode: '0606', shortName: 'LEAPCO', fullName: 'Leap Company Berhad', board: ListingBoard.Leap, sectorName: 'Technology', shariah: null },
];

// Module-scope harness state (the helpers below run inside beforeAll).
let pgContainer: StartedPostgreSqlContainer;
let redisContainer: StartedRedisContainer;
let dataSource: DataSource;

describe('Screener endpoint (integration — testcontainers)', () => {
  let moduleRef: TestingModule;
  let redis: Redis;

  let controller: ScreenerController;
  let service: ScreenerService;
  let readCache: ReadCacheService;
  let screenSpy: jest.SpyInstance;

  /** Screen through the endpoint, returning stockCodes in page order. */
  const codes = async (raw: RawScreenerParams): Promise<string[]> =>
    (await controller.screen(raw)).items.map((r) => r.stockCode);

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

    await seedUniverse();

    // Boot the REAL ScreenerModule (ConfigModule → env URLs, RedisModule →
    // the shared client, DataModule → its own DataSource against the same
    // container) — the "composes" seam, no schedule/worker bits.
    moduleRef = await bootModule();
    controller = moduleRef.get(ScreenerController);
    service = moduleRef.get(ScreenerService);
    readCache = moduleRef.get(ReadCacheService);
    redis = moduleRef.get<Redis>(REDIS_CLIENT);
    screenSpy = jest.spyOn(moduleRef.get<ScreenerQuery>(SCREENER_QUERY), 'screen');
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

  it('ScreenerModule composes: controller + service resolve, the route is anonymous, no schedule bits', async () => {
    expect(controller).toBeInstanceOf(ScreenerController);
    expect(service).toBeInstanceOf(ScreenerService);

    // Anonymous (ADR-0005): no @RequiresJob metadata → the global TierGuard
    // passes the route through.
    expect(
      Reflect.getMetadata(REQUIRES_JOB_KEY, ScreenerController.prototype.screen),
    ).toBeUndefined();

    // No schedule/worker bits pulled in by the screener module (cron isolation).
    const screenerImports: unknown[] =
      Reflect.getMetadata('imports', ScreenerModule) ?? [];
    const importsSchedule = screenerImports.some(
      (imp) =>
        imp === ScheduleModule ||
        (imp as { module?: unknown })?.module === ScheduleModule,
    );
    expect(importsSchedule).toBe(false);
  });

  // --- default screen + echo ---------------------------------------------------

  it('default screen returns the analysed universe, default %change desc NULLs last, resolved defaults echoed', async () => {
    const res = await controller.screen({});
    // Wire-form check against the contract (ADR-0014): what the SPA receives.
    parseOrThrow(ScreenerResponse, JSON.parse(JSON.stringify(res)));
    expect(res.sort).toBe('pctChange');
    expect(res.dir).toBe('desc');
    expect(res.offset).toBe(0);
    expect(res.limit).toBe(50);
    expect(res.total).toBe(5);
    expect(res.items.map((r) => r.stockCode)).toEqual([
      '0404', // +10%
      '0505', // +2.5%
      '0101', // +2%
      '0303', // -1.25%
      '0202', // null (one bar) — NULLs sort last
    ]);
  });

  it('one row carries the spec-03 shape with per-numeric-class provenance', async () => {
    const res = await controller.screen({ peMax: '10' });
    const profit = res.items.find((r) => r.stockCode === '0101');
    if (!profit) throw new Error('0101 missing from the peMax=10 screen');
    expect(profit).toEqual({
      stockCode: '0101',
      shortName: 'PROFIT',
      sector: 'Financial Services',
      close: 10.2,
      pctChange: 2, // (10.2 − 10) ÷ 10 × 100
      marketCap: 10200, // 10.2 × 1000 shares
      pe: 8.5,
      dy: 0.04,
      pNta: 1.1,
      roe: 0.12,
      de: 0.5,
      // Read-time IngestionRun lineage: bars/fundamentals/indicators all
      // synthetic in the seed; reference fields (code/name/sector) are real
      // by contract, not per-row.
      provenance: {
        price: ProvenanceClass.Synthetic,
        fundamentals: ProvenanceClass.Synthetic,
        technicals: ProvenanceClass.Synthetic,
      },
    });
  });

  // --- one representative filter per class survives the endpoint --------------

  it.each([
    ['board=ACE', { board: 'ACE' }, ['0303']],
    ['shariah=true', { shariah: 'true' }, ['0404', '0505', '0101']],
    ['priceMin=9', { priceMin: '9' }, ['0101']],
    ['volumeMin=1500000', { volumeMin: '1500000' }, ['0303']],
    ['peMax=15 (loss-maker NULL excluded)', { peMax: '15' }, ['0505', '0101', '0303']],
    ['dyMin=0.01 (NULL DY excluded)', { dyMin: '0.01' }, ['0505', '0101']],
    ['deMax=0.5 (inclusive)', { deMax: '0.5' }, ['0404', '0505', '0101']],
    ['profitableYearsMin=3', { profitableYearsMin: '3' }, ['0505', '0101', '0303']],
    ['yoyProfitGrowthMin=0', { yoyProfitGrowthMin: '0' }, ['0505', '0101', '0303']],
    ['consecutiveGrowthQuartersMin=4', { consecutiveGrowthQuartersMin: '4' }, ['0505', '0101']],
    ['rsi14 50–60 band', { rsi14Min: '50', rsi14Max: '60' }, ['0404', '0101']],
    ['aboveSma50=true (NULL sma matches neither)', { aboveSma50: 'true' }, ['0404', '0101']],
  ])('%s → %j', async (_name, raw, expected) => {
    expect(await codes(raw)).toEqual(expected);
  });

  it('sector filter is by FK id list through the endpoint (no string match)', async () => {
    const tech = await dataSource
      .getRepository(Sector)
      .findOneByOrFail({ name: 'Technology' });
    expect(await codes({ sector: tech.id })).toEqual(['0303', '0202']);
    // Unknown-but-valid UUID → empty screen, never an error.
    const none = await controller.screen({
      sector: '00000000-0000-0000-0000-0000000000ff',
    });
    expect(none.items).toEqual([]);
    expect(none.total).toBe(0);
  });

  // --- sort/dir/offset/limit parse + echo resolved values ----------------------

  it('sort/dir/offset/limit parse and echo their resolved values', async () => {
    const res = await controller.screen({
      sort: 'pe',
      dir: 'asc',
      offset: '1',
      limit: '2',
    });
    // pe asc NULLs last: 0101, 0505, 0303, 0404, 0202(null) → window [1,3).
    expect(res.items.map((r) => r.stockCode)).toEqual(['0505', '0303']);
    expect(res).toMatchObject({
      sort: 'pe',
      dir: 'asc',
      offset: 1,
      limit: 2,
      total: 5,
    });
  });

  it('odd params clamp/drop to their resolved defaults, never a 400 (echo reflects it)', async () => {
    const clamped = await controller.screen({ limit: '500', offset: '-3' });
    expect(clamped.limit).toBe(100); // hard max
    expect(clamped.offset).toBe(0); // floored
    const defaulted = await controller.screen({
      sort: 'rsi14', // filter, not a returned column → dropped to default
      dir: 'up',
      limit: 'abc',
    });
    expect(defaulted).toMatchObject({
      sort: 'pctChange',
      dir: 'desc',
      limit: 50,
    });
  });

  // --- class-2 cache ------------------------------------------------------------

  it('identical screens hit the class-2 cache: rotated/clamped-equivalent variants share one entry and are not re-queried', async () => {
    // Isolate the keyspace assertion (earlier endpoint tests cached entries).
    await redis.flushdb();

    const callsBefore = screenSpy.mock.calls.length;
    const first = await controller.screen({ dyMin: '0.01', board: 'MAIN,ACE' });
    expect(first.items.map((r) => r.stockCode)).toEqual(['0505', '0101']);
    expect(screenSpy.mock.calls.length).toBe(callsBefore + 1);

    // Same screen, board list rotated + the default limit spelled out:
    // same resolved params → same canonical key → cache hit, no re-query.
    const second = await controller.screen({
      board: 'ACE,MAIN',
      dyMin: '0.01',
      limit: '50',
    });
    expect(second.items).toEqual(first.items);
    expect(second.sort).toBe(first.sort);
    expect(screenSpy.mock.calls.length).toBe(callsBefore + 1);

    // Exactly one class-2 key, and it IS the canonical key (unit-pinned shape).
    const keys = await redis.keys(`${SCREENER_CACHE_PREFIX}*`);
    expect(keys).toEqual([
      screenerCacheKey(parseScreenerQuery({ dyMin: '0.01', board: 'MAIN,ACE' })),
    ]);
  });

  it('clamped pagination equivalents share one entry (limit=500 ≡ limit=100)', async () => {
    const callsBefore = screenSpy.mock.calls.length;
    const a = await controller.screen({ peMax: '15', limit: '500' });
    expect(a.limit).toBe(100);
    const b = await controller.screen({ peMax: '15', limit: '100' });
    expect(b.items).toEqual(a.items);
    expect(b.total).toBe(a.total);
    expect(screenSpy.mock.calls.length).toBe(callsBefore + 1);
  });

  it('the nightly ingest sweep invalidates cached screens: a swept prefix forces a re-query', async () => {
    const first = await controller.screen({ volumeMin: '1500000' });
    const callsBefore = screenSpy.mock.calls.length; // includes the warm call

    // The SAME prefix sweep the nightly ingest + purge perform post-commit
    // (pinned end-to-end in ingestion.int.spec.ts): every cached screen
    // lives under it, so clearing it must force the next call back to the seam.
    const deleted = await readCache.invalidatePrefix(SCREENER_CACHE_PREFIX);
    expect(deleted).toBeGreaterThan(0);

    const second = await controller.screen({ volumeMin: '1500000' });
    expect(screenSpy.mock.calls.length).toBe(callsBefore + 1);
    expect(second.items).toEqual(first.items);
    expect(second.total).toBe(first.total);
  });
});

// --- fixtures -------------------------------------------------------------------

const envBackup: Record<string, string | undefined> = {};

/** Boot the real ScreenerModule against the testcontainers URLs (env-backed). */
async function bootModule() {
  const env: Record<'DATABASE_URL' | 'REDIS_URL' | 'SESSION_SECRET', string> = {
    DATABASE_URL: pgContainer.getConnectionUri(),
    REDIS_URL: redisContainer.getConnectionUrl(),
    SESSION_SECRET: 'screener-endpoint-int-spec',
  };
  (Object.keys(env) as (keyof typeof env)[]).forEach((key) => {
    envBackup[key] = process.env[key];
    process.env[key] = env[key];
  });

  return Test.createTestingModule({
    imports: [ConfigModule, RedisModule, ScreenerModule],
  }).compile();
}

/**
 * Seed the hand-controlled universe (the ticket-01 read-model suite's seed:
 * real reference run + synthetic data run). Static — no mid-suite mutation,
 * so cache expectations stay deterministic.
 */
async function seedUniverse(): Promise<void> {
  const runs = new IngestionRunService();
  const realRun = await runs.openRun(
    dataSource.manager,
    'ScreenerEndpointSeedReferenceAdapter',
    ProvenanceClass.Real,
  );
  const syntheticRun = await runs.openRun(
    dataSource.manager,
    'ScreenerEndpointSeedSyntheticAdapter',
    ProvenanceClass.Synthetic,
  );

  const sectorRepo = dataSource.getRepository(Sector);
  const sectorByName = new Map<string, string>();
  const ensureSector = async (name: string): Promise<string> => {
    const cached = sectorByName.get(name);
    if (cached) return cached;
    const sector = await sectorRepo.save(
      sectorRepo.create({ name, subsector: null, ingestionRunId: realRun.id }),
    );
    sectorByName.set(name, sector.id);
    return sector.id;
  };

  const companyRepo = dataSource.getRepository(Company);
  const instrumentRepo = dataSource.getRepository(Instrument);

  for (const entry of SEED_COMPANIES) {
    const sectorId = await ensureSector(entry.sectorName);
    const company = await companyRepo.save(
      companyRepo.create({
        fullName: entry.fullName,
        board: entry.board,
        aliases: [],
        sectorId,
        ingestionRunId: realRun.id,
      }),
    );
    const instrument = await instrumentRepo.save(
      instrumentRepo.create({
        stockCode: entry.stockCode,
        shortName: entry.shortName,
        fullName: entry.fullName,
        companyId: company.id,
        ingestionRunId: realRun.id,
      }),
    );

    if (entry.shariah) {
      const [status, effectiveDate] = entry.shariah;
      await dataSource.getRepository(ShariahStatus).save(
        dataSource.getRepository(ShariahStatus).create({
          companyId: company.id,
          status,
          effectiveDate,
          ingestionRunId: realRun.id,
        }),
      );
    }

    // LEAP row stops here — no synthetic data, and the universe filter
    // excludes it anyway.
    if (entry.board === ListingBoard.Leap) continue;

    const instrumentId = instrument.id;
    const profits = QUARTERLY_PROFITS[entry.stockCode];
    await dataSource.getRepository(QuarterlyFinancials).save(
      profits.map((netProfit, i) =>
        dataSource.getRepository(QuarterlyFinancials).create({
          companyId: company.id,
          fiscalYear: 2023 + Math.floor(i / 4),
          fiscalQuarter: (i % 4) + 1,
          periodEnd: PERIOD_ENDS[i],
          revenue: '1000',
          netProfit: netProfit.toFixed(2),
          eps: '0.1',
          equity: '10000',
          nta: '9000',
          intangibles: '1000',
          totalBorrowings: '5000',
          ingestionRunId: syntheticRun.id,
        }),
      ),
    );

    const bars = PRICE_BARS[entry.stockCode];
    const barDates = ['2025-12-30', '2025-12-31'];
    const closes =
      bars.prev === null ? [bars.close] : [bars.prev, bars.close];
    await dataSource.getRepository(PriceBar).save(
      closes.map((close, i) =>
        dataSource.getRepository(PriceBar).create({
          instrumentId,
          tradeDate: barDates[i],
          open: close,
          high: close,
          low: close,
          close,
          volume: bars.volume,
          ingestionRunId: syntheticRun.id,
        }),
      ),
    );

    await dataSource.getRepository(FundamentalsSnapshot).save(
      dataSource.getRepository(FundamentalsSnapshot).create({
        companyId: company.id,
        sharesOutstanding: '1000',
        ntaPerShare: '9.0',
        ttmEps: '0.4',
        ttmRevenue: '4000',
        ttmNetProfit: '400',
        psr: '1.0',
        ...SNAPSHOT_VALUES[entry.stockCode],
        ingestionRunId: syntheticRun.id,
      }),
    );

    const indicator = INDICATOR_VALUES[entry.stockCode];
    await dataSource.getRepository(IndicatorSnapshot).save(
      dataSource.getRepository(IndicatorSnapshot).create({
        instrumentId,
        latestClose: bars.close,
        sma20: indicator.sma20 ?? null,
        sma50: indicator.sma50 ?? null,
        sma200: indicator.sma200 ?? null,
        rsi14: indicator.rsi14 ?? null,
        macd: null,
        macdSignal: null,
        week52High: null,
        week52Low: null,
        ingestionRunId: syntheticRun.id,
      }),
    );
  }
}
