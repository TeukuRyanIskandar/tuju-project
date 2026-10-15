import IORedis, { type Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

import {
  FUNDAMENTALS_ADAPTER,
  MARKET_DATA_ADAPTER,
  type FundamentalsAdapter,
  type MarketDataAdapter,
} from '../data/adapters';
import type { FundamentalsDto, PriceBarDto } from '../data/adapters/dto';
import { REDIS_CLIENT } from '../redis/redis.module';
import { ReadCacheService } from '../cache/read-cache.service';
import {
  Announcement,
  Company,
  CorporateAction,
  FundamentalsSnapshot,
  IndicatorSnapshot,
  IndexLevel,
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
import { AnalysisResult } from '../data/entities/analysis-result.entity';
import { ProvenanceClass } from '../data/entities/enums';
import { InitialSchema1727600000000 } from '../data/migrations/1727600000000-InitialSchema';
import { FreeTierDomainModel1727700000000 } from '../data/migrations/1727700000000-FreeTierDomainModel';
import { ReIngestNaturalKeys1727800000000 } from '../data/migrations/1727800000000-ReIngestNaturalKeys';
import { DisclosureReadModel1727900000000 } from '../data/migrations/1727900000000-DisclosureReadModel';
import { MarketIndexModel1728000000000 } from '../data/migrations/1728000000000-MarketIndexModel';
import {
  DISCLOSURE_ADAPTER,
  INDEX_ADAPTER,
  IPO_ADAPTER,
  NEWS_ADAPTER,
  SHARIAH_LIST_ADAPTER,
} from '../data/adapters/adapter.interfaces';
import {
  AggregatorDisclosureAdapter,
  ManualIpoAdapter,
  ManualShariahListAdapter,
  RssNewsAdapter,
  SyntheticIndexAdapter,
} from '../data/adapters/demo-adapters';
import { JobBus } from '../jobbus/job-bus.service';
import { EodIngestService } from './eod-ingest.service';
import { IngestionRunService } from './ingestion-run.service';
import { ReferenceDataService } from './reference-data.service';
import { KlciEnqueueService } from './klci-enqueue.service';
import { KlciSeedService } from './klci-seed.service';
import { KLCI30_UNIVERSE } from './klci30-universe';

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

const SUBSET = KLCI30_UNIVERSE.slice(0, 2);

function makeBars(stockCode: string, days: number): PriceBarDto[] {
  const bars: PriceBarDto[] = [];
  const start = new Date('2023-01-03T00:00:00.000Z');
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const close = 10 + i * 0.01;
    bars.push({
      stockCode,
      tradeDate: d.toISOString().slice(0, 10),
      open: close - 0.05,
      high: close + 0.1,
      low: close - 0.1,
      close,
      volume: 1_000_000 + i,
    });
  }
  return bars;
}

class FakeKlciMarketAdapter implements MarketDataAdapter {
  readonly provenanceClass = ProvenanceClass.Real;
  private failures: string[] = [];

  getFailureSummary(): readonly string[] {
    return this.failures;
  }

  fetchDailyBars(): Promise<PriceBarDto[]> {
    this.failures = [];
    return Promise.resolve(SUBSET.flatMap((row) => makeBars(row.stockCode, 260)));
  }
}

class FakeKlciFundamentalsAdapter implements FundamentalsAdapter {
  readonly provenanceClass = ProvenanceClass.Real;
  private failures: string[] = [];
  private dividendsByStockCode = new Map<
    string,
    readonly { readonly exDate: string; readonly amount: number }[]
  >();

  getFailureSummary(): readonly string[] {
    return this.failures;
  }

  getDividendsByStockCode() {
    return this.dividendsByStockCode;
  }

  fetchFundamentals(): Promise<FundamentalsDto[]> {
    this.failures = [];
    this.dividendsByStockCode = new Map(
      SUBSET.map((row) => [
        row.stockCode,
        [{ exDate: '2024-06-15', amount: 0.1 }],
      ]),
    );
    return Promise.resolve(
      SUBSET.map((row) => ({
        stockCode: row.stockCode,
        sharesOutstanding: 1_000_000_000,
        quarters: [1, 2, 3, 4].map((fiscalQuarter) => ({
          stockCode: row.stockCode,
          fiscalYear: 2024,
          fiscalQuarter,
          periodEnd: `2024-${String(fiscalQuarter * 3).padStart(2, '0')}-${fiscalQuarter === 1 || fiscalQuarter === 4 ? '31' : '30'}`,
          revenue: 1_000_000_000,
          netProfit: 100_000_000,
          eps: 0.1,
          equity: 5_000_000_000,
          nta: 4_500_000_000,
          intangibles: 100_000_000,
          totalBorrowings: 500_000_000,
        })),
      })),
    );
  }
}

describe('KLCI seed + ingest ops', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let dataSource: DataSource;
  let redis: Redis;
  let seed: KlciSeedService;
  let eod: EodIngestService;
  let jobBus: JobBus;

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
        MarketIndexModel1728000000000,
      ],
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    redis = new IORedis(redisContainer.getConnectionUrl(), {
      maxRetriesPerRequest: null,
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: DataSource, useValue: dataSource },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: MARKET_DATA_ADAPTER, useClass: FakeKlciMarketAdapter },
        { provide: FUNDAMENTALS_ADAPTER, useClass: FakeKlciFundamentalsAdapter },
        { provide: DISCLOSURE_ADAPTER, useClass: AggregatorDisclosureAdapter },
        { provide: NEWS_ADAPTER, useClass: RssNewsAdapter },
        { provide: SHARIAH_LIST_ADAPTER, useClass: ManualShariahListAdapter },
        { provide: IPO_ADAPTER, useClass: ManualIpoAdapter },
        { provide: INDEX_ADAPTER, useClass: SyntheticIndexAdapter },
        IngestionRunService,
        ReferenceDataService,
        KlciSeedService,
        ReadCacheService,
        JobBus,
        EodIngestService,
        // Ticket-05 nightly follow-on seam: `ingestKlci` (what this spec
        // exercises) never calls it; a no-op stub satisfies the constructor.
        {
          provide: KlciEnqueueService,
          useValue: {
            enqueue: async () =>
              ({ enqueued: [], skipped: [], alreadyInFlight: [], failed: [] }) as const,
          },
        },
      ],
    }).compile();

    seed = moduleRef.get(KlciSeedService);
    eod = moduleRef.get(EodIngestService);
    jobBus = moduleRef.get(JobBus);
  });

  afterAll(async () => {
    await jobBus?.onModuleDestroy();
    await redis?.quit();
    if (dataSource?.isInitialized) await dataSource.destroy();
    await redisContainer?.stop();
    await pgContainer?.stop();
  });

  it('seed-klci upserts 30 instruments and is idempotent on re-run', async () => {
    const first = await seed.seedKlci();
    expect(first.instruments).toBe(30);
    expect(first.companies).toBe(30);
    expect(await dataSource.getRepository(Instrument).count()).toBe(30);

    const maybank = await dataSource.getRepository(Instrument).findOneOrFail({
      where: { stockCode: '1155' },
      relations: { company: true },
    });
    expect(maybank.shortName).toBe('MAYBANK');
    expect(maybank.company.aliases).toEqual(
      expect.arrayContaining(['MAYBANK', 'Maybank']),
    );

    await dataSource.getRepository(Instrument).update(
      { stockCode: '1155' },
      { shortName: 'STALE' },
    );

    const second = await seed.seedKlci();
    expect(second.instruments).toBe(30);
    expect(await dataSource.getRepository(Instrument).count()).toBe(30);

    const refreshed = await dataSource.getRepository(Instrument).findOneOrFail({
      where: { stockCode: '1155' },
    });
    expect(refreshed.shortName).toBe('MAYBANK');
  });

  it('ingest-klci with fake adapters writes bars + snapshots for a subset', async () => {
    await seed.seedKlci();

    const result = await eod.ingestKlci();
    expect(result.failures).toEqual([]);
    expect(result.priceBars).toBeGreaterThan(0);
    expect(result.fundamentalsSnapshots).toBe(SUBSET.length);
    expect(result.indicatorSnapshots).toBe(SUBSET.length);

    const run = await dataSource.getRepository(IngestionRun).findOneOrFail({
      where: { id: result.runId },
    });
    expect(run.provenanceClass).toBe(ProvenanceClass.Real);
    expect(run.adapter).toBe('YFinanceMarketDataAdapter');

    for (const row of SUBSET) {
      const instrument = await dataSource.getRepository(Instrument).findOneOrFail({
        where: { stockCode: row.stockCode },
      });
      expect(
        await dataSource.getRepository(PriceBar).count({
          where: { instrumentId: instrument.id },
        }),
      ).toBeGreaterThan(150);
      expect(
        await dataSource.getRepository(IndicatorSnapshot).count({
          where: { instrumentId: instrument.id },
        }),
      ).toBe(1);
      expect(
        await dataSource.getRepository(FundamentalsSnapshot).count({
          where: { companyId: instrument.companyId },
        }),
      ).toBe(1);
    }
  });
});
