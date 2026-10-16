/**
 * Stock-page integration test (ticket 03 testing seam; ADR-0011).
 *
 * Exercises the ticket's highest-value behaviours against REAL infra via
 * testcontainers (throwaway Postgres + Redis, the same stack ADR-0006 runs in
 * compose) — not mocks, because what is decided here (per-block provenance
 * lineage joins, ratios READ from materialised columns, the read-time %change,
 * class-2 read-through caching with 404s never cached) is exactly what a mock
 * silently gets wrong:
 *
 *   1. The core payload composes identity ⋈ fundamentals ⋈ technicals ⋈ shariah,
 *      matching the STORED ratios exactly (read, not recomputed) with JS
 *      numbers and per-block provenance descriptors.
 *   2. A loss-maker keeps its stored null P/E and derives `lossMaking`.
 *   3. A sparse company (identity only) serves null blocks gracefully.
 *   4. The two disclosure lists: ordering, pagination bounds/clamping, totals.
 *   5. Unknown code 404s on all three endpoints — and is never cached.
 *   6. Primed pages are served from the class-2 cache without re-query.
 *
 * Seeding is direct (NOT via the ingest): runs of each provenance class, one
 * instrument with the full graph, a loss-maker, and a sparse company. This is
 * a `.spec.ts` (runs in the default `test` lane, matching
 * `src/ingestion/ingestion.int.spec.ts` prior art); Docker is required and
 * guaranteed available per the ticket.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  AnnouncementsPage,
  CorporateActionsPage,
  StockCorePayload,
  StockFundamentalAnalysisResponse,
  StockSeriesResponse,
  StockTechnicalAnalysisResponse,
  parseOrThrow,
} from '@tuju/contracts';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import IORedis, { type Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

import { REDIS_CLIENT } from '../redis/redis.module';
import { ReadModelCache, DEFAULT_READ_CACHE_TTL_SECONDS } from '../cache/read-model-cache';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { STOCKS_CACHE_PREFIX } from '../cache/cache-keys';
import {
  Announcement,
  AnalysisResult,
  Company,
  CorporateAction,
  FundamentalsSnapshot,
  FundamentalAnalysis,
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
  TechnicalAnalysis,
  Watchlist,
  WatchlistItem,
} from '../data/entities';
import { InitialSchema1727600000000 } from '../data/migrations/1727600000000-InitialSchema';
import { FreeTierDomainModel1727700000000 } from '../data/migrations/1727700000000-FreeTierDomainModel';
import { DisclosureReadModel1727900000000 } from '../data/migrations/1727900000000-DisclosureReadModel';
import { StockAnalyses1728300000000 } from '../data/migrations/1728300000000-StockAnalyses';
import {
  AnnouncementCategory,
  CorporateActionType,
  ListingBoard,
  ProvenanceClass,
  ShariahComplianceStatus,
  StockAnalysisStatus,
} from '../data/entities/enums';
import {
  REFERENCE_UNIVERSE,
  type ReferenceCompany,
} from '../ingestion/reference-universe';
import { S3_CLIENT } from '../s3/s3.module';
import { AnalysisResultStore } from '../analysis/analysis-result.store';
import { StockAnalysis } from '../analysis/stock-analysis';
import { JobBus } from '../jobbus/job-bus.service';
import { InMemoryJobBus } from '../jobbus/in-memory-job-bus';

import { StocksController } from './stocks.controller';
import { StocksService } from './stocks.service';
import { MAX_PAGE_LIMIT } from './pagination';

jest.setTimeout(180_000);

/** Minimal AppConfig for testing (ReadModelCache reads the class-2 TTL from it). */
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
  TechnicalAnalysis,
  FundamentalAnalysis,
];

// MAYBANK 1155 (full graph), CIMB 1023 (sparse), AXIATA 6888 (loss-maker),
// INARI 0200 (seeded but outside KLCI 30 — ticket 06 hard-gate).
const [MAYBANK, CIMB, , AXIATA, INARI] = REFERENCE_UNIVERSE;

const TECHNICAL_ARTIFACT = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      '../../../../packages/contracts/fixtures/technical-analysis-artifact.json',
    ),
    'utf-8',
  ),
) as Record<string, unknown>;

/** Stored MAYBANK-scale fundamental figures (asserted as-read, never recomputed). */
const MAYBANK_FUNDAMENTALS = {
  sharesOutstanding: '8700000000',
  ntaPerShare: '3.100000',
  ttmEps: '0.551230',
  ttmRevenue: '51234000000.00',
  ttmNetProfit: '4800000000.00',
  peRatio: '18.300000',
  dividendYield: '0.056700',
  pntaRatio: '3.240000',
  roe: '0.113400',
  debtToEquity: '0.970000',
  psr: '3.380000',
  consecutiveGrowthQuarters: 4,
};

const MAYBANK_INDICATOR = {
  latestClose: '10.020000',
  sma20: '9.700000',
  sma50: '9.550000',
  sma200: '9.300000',
  rsi14: '57.400000',
  macd: '0.021230',
  macdSignal: '0.015000',
  week52High: '10.450000',
  week52Low: '8.320000',
};

/** Three EOD bars; the two latest drive the read-time %change. */
const MAYBANK_BARS = [
  { tradeDate: '2026-09-28', close: '9.800000' },
  { tradeDate: '2026-09-29', close: '9.870000' },
  { tradeDate: '2026-09-30', close: '10.020000' },
];

/** Latest 2 quarters for growth metrics (newest first). */
const MAYBANK_QUARTERS = [
  {
    fiscalYear: 2026,
    fiscalQuarter: 2,
    periodEnd: '2026-06-30',
    revenue: '12800000000.00',
    netProfit: '1200000000.00',
    eps: '0.137931',
    equity: '20000000000.00',
    nta: '26000000000.00',
    intangibles: '200000000.00',
    totalBorrowings: '19400000000.00',
  },
  {
    fiscalYear: 2026,
    fiscalQuarter: 1,
    periodEnd: '2026-03-31',
    revenue: '12600000000.00',
    netProfit: '1180000000.00',
    eps: '0.135632',
    equity: '19500000000.00',
    nta: '25500000000.00',
    intangibles: '200000000.00',
    totalBorrowings: '18900000000.00',
  },
];

const MAYBANK_ANNOUNCEMENTS = [
  {
    category: AnnouncementCategory.FinancialResults,
    title: 'Quarterly report on consolidated results',
    filedAt: new Date('2026-09-28T10:00:00Z'),
    sourceUrl: 'https://example-bursa-feed/1155/results-q2',
    aiSummary: 'Net profit rose on higher net interest income.',
  },
  {
    category: AnnouncementCategory.Entitlement,
    title: 'Single tier interim dividend',
    filedAt: new Date('2026-09-26T09:30:00Z'),
    sourceUrl: 'https://example-bursa-feed/1155/dividend',
    aiSummary: null,
  },
  {
    category: AnnouncementCategory.ShareholdingChange,
    title: 'Dealing in listed shares by director',
    filedAt: new Date('2026-09-20T16:45:00Z'),
    sourceUrl: null,
    aiSummary: null,
  },
];

const MAYBANK_CORPORATE_ACTIONS = [
  { type: CorporateActionType.Dividend, exDate: '2025-12-05', amount: '0.300000' },
  { type: CorporateActionType.Bonus, exDate: '2026-03-05', amount: null },
  { type: CorporateActionType.Dividend, exDate: '2026-06-12', amount: '0.280000' },
];

describe('Stocks endpoints (integration — testcontainers)', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let dataSource: DataSource;
  let redis: Redis;

  let controller: StocksController;
  let service: StocksService;
  let readCache: ReadModelCache;

  // Lineage runs of each provenance class (seeded directly, not via the ingest).
  let realRefRun: IngestionRun;
  let realShariahRun: IngestionRun;
  let synthFundRun: IngestionRun;
  let synthIndicatorRun: IngestionRun;
  let synthPriceRun: IngestionRun;
  let aggregatorRun: IngestionRun;

  let maybankCompanyId: string;
  let maybankInstrumentId: string;

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
        DisclosureReadModel1727900000000,
        StockAnalyses1728300000000,
      ],
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    redis = new IORedis(redisContainer.getConnectionUrl(), {
      maxRetriesPerRequest: null,
    });

    const fakeS3 = {
      send: async () => ({
        Body: {
          transformToString: async () => JSON.stringify(TECHNICAL_ARTIFACT),
        },
      }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [StocksController],
      providers: [
        { provide: DataSource, useValue: dataSource },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: S3_CLIENT, useValue: fakeS3 },
        { provide: APP_CONFIG, useValue: fakeConfig() },
        { provide: JobBus, useValue: new InMemoryJobBus() },
        // StocksService / StockAnalysis inject per-entity repositories
        // (TypeOrmModule.forFeature); bind each token to the container DataSource.
        ...[
          AnalysisResult,
          TechnicalAnalysis,
          FundamentalAnalysis,
          IndicatorSnapshot,
          FundamentalsSnapshot,
          QuarterlyFinancials,
          PriceBar,
          Announcement,
          CorporateAction,
          ShariahStatus,
          Instrument,
        ].map((entity) => ({
          provide: getRepositoryToken(entity),
          useValue: dataSource.getRepository(entity),
        })),
        ReadModelCache,
        AnalysisResultStore,
        StockAnalysis,
        StocksService,
      ],
    }).compile();

    controller = moduleRef.get(StocksController);
    service = moduleRef.get(StocksService);
    readCache = moduleRef.get(ReadModelCache);

    await seedFixtures();
  });

  afterAll(async () => {
    await redis?.quit();
    if (dataSource?.isInitialized) await dataSource.destroy();
    await redisContainer?.stop();
    await pgContainer?.stop();
  });

  it('core composes the full graph: stored ratios (read, not recomputed), read-time %change, per-block provenance', async () => {
    const core = await service.getCore(MAYBANK.stockCode);
    // Wire-form check against the contract (ADR-0014): what the SPA receives.
    parseOrThrow(StockCorePayload, JSON.parse(JSON.stringify(core)));

    // Identity ⋈ Company ⋈ Sector, provenance = the instrument row's run class.
    expect(core.identity).toEqual({
      provenance: ProvenanceClass.Real,
      stockCode: MAYBANK.stockCode,
      shortName: MAYBANK.shortName,
      fullName: MAYBANK.fullName,
      companyName: MAYBANK.fullName,
      board: ListingBoard.Main,
      sector: 'Financial Services',
    });
    expect(core.identity.provenance).toBe(realRefRun.provenanceClass);

    // Fundamentals: every figure matches the STORED snapshot row exactly.
    const storedFund = await dataSource
      .getRepository(FundamentalsSnapshot)
      .findOneByOrFail({ companyId: maybankCompanyId });
    const fund = core.fundamentals!;
    expect(fund.provenance).toBe(synthFundRun.provenanceClass);
    expect(fund.provenance).toBe(ProvenanceClass.Synthetic);
    expect(fund.peRatio).toBe(Number(storedFund.peRatio));
    expect(fund.dividendYield).toBe(Number(storedFund.dividendYield));
    expect(fund.pntaRatio).toBe(Number(storedFund.pntaRatio));
    expect(fund.roe).toBe(Number(storedFund.roe));
    expect(fund.debtToEquity).toBe(Number(storedFund.debtToEquity));
    expect(fund.psr).toBe(Number(storedFund.psr));
    expect(fund.ttmEps).toBe(Number(storedFund.ttmEps));
    expect(fund.ttmRevenue).toBe(Number(storedFund.ttmRevenue));
    expect(fund.ttmNetProfit).toBe(Number(storedFund.ttmNetProfit));
    expect(fund.ntaPerShare).toBe(Number(storedFund.ntaPerShare));
    expect(fund.sharesOutstanding).toBe(Number(storedFund.sharesOutstanding));
    expect(fund.consecutiveGrowthQuarters).toBe(
      storedFund.consecutiveGrowthQuarters,
    );
    expect(fund.lossMaking).toBe(false); // ttmEps > 0

    // Every numeric is a JS number (TypeORM numeric strings converted once).
    const fundNumerics = [
      'peRatio', 'dividendYield', 'pntaRatio', 'roe', 'debtToEquity', 'psr',
      'ttmEps', 'ttmRevenue', 'ttmNetProfit', 'ntaPerShare', 'sharesOutstanding',
    ] as const;
    for (const key of fundNumerics) {
      expect(typeof fund[key]).toBe('number');
    }

    // Technicals: stored indicator row + the read-time %change from the two
    // latest bars ((latest − prev) / prev × 100).
    const storedIndicator = await dataSource
      .getRepository(IndicatorSnapshot)
      .findOneByOrFail({ instrumentId: maybankInstrumentId });
    const tech = core.technicals!;
    expect(tech.provenance).toBe(synthIndicatorRun.provenanceClass);
    expect(tech.provenance).toBe(ProvenanceClass.Synthetic);
    expect(tech.sma20).toBe(Number(storedIndicator.sma20));
    expect(tech.sma50).toBe(Number(storedIndicator.sma50));
    expect(tech.sma200).toBe(Number(storedIndicator.sma200));
    expect(tech.rsi14).toBe(Number(storedIndicator.rsi14));
    expect(tech.macd).toBe(Number(storedIndicator.macd));
    expect(tech.macdSignal).toBe(Number(storedIndicator.macdSignal));
    expect(tech.week52High).toBe(Number(storedIndicator.week52High));
    expect(tech.week52Low).toBe(Number(storedIndicator.week52Low));
    expect(tech.latestClose).toBe(Number(storedIndicator.latestClose));

    const latest = Number(MAYBANK_BARS[2].close);
    const prev = Number(MAYBANK_BARS[1].close);
    expect(tech.pctChange).toBeCloseTo(((latest - prev) / prev) * 100, 10);
    expect(tech.pctChange).not.toBeNull();
    expect(typeof tech.pctChange).toBe('number');

    // Shariah: the LATEST row by effectiveDate (of two), real provenance.
    expect(core.shariah).toEqual({
      provenance: realShariahRun.provenanceClass,
      status: ShariahComplianceStatus.Compliant,
      effectiveDate: '2025-11-28',
    });
    expect(core.shariah.provenance).toBe(ProvenanceClass.Real);
  });

  it('loss-maker keeps its stored null P/E and derives lossMaking (no recomputed P/E)', async () => {
    const core = await service.getCore(AXIATA.stockCode);

    expect(core.identity.stockCode).toBe(AXIATA.stockCode);
    expect(core.fundamentals!.lossMaking).toBe(true); // ttmEps < 0
    expect(core.fundamentals!.peRatio).toBeNull(); // stored null passes through
    expect(core.fundamentals!.dividendYield).toBeNull(); // null passthrough
    expect(core.fundamentals!.ttmEps).toBe(-0.0834);
    expect(core.fundamentals!.roe).toBe(-0.021);
    expect(core.fundamentals!.consecutiveGrowthQuarters).toBe(0);
    expect(core.fundamentals!.provenance).toBe(ProvenanceClass.Synthetic);
  });

  it('sparse company (identity only) serves null blocks gracefully — only the unknown code 404s', async () => {
    const core = await service.getCore(CIMB.stockCode);

    expect(core.identity.stockCode).toBe(CIMB.stockCode);
    expect(core.identity.provenance).toBe(ProvenanceClass.Real);
    expect(core.fundamentals).toBeNull();
    expect(core.technicals).toBeNull();
    // No shariah row → null fields, provenance still `real`.
    expect(core.shariah).toEqual({
      provenance: ProvenanceClass.Real,
      status: null,
      effectiveDate: null,
    });

    // Its disclosure lists are empty pages, not 404s.
    const announcements = await service.getAnnouncements(CIMB.stockCode, 0, 50);
    expect(announcements).toEqual({ items: [], total: 0, offset: 0, limit: 50 });
    const actions = await service.getCorporateActions(CIMB.stockCode, 0, 50);
    expect(actions).toEqual({ items: [], total: 0, offset: 0, limit: 50 });
  });

  it('announcements list: newest filedAt first, pagination bounds, clamped limit, per-item aggregator provenance', async () => {
    // Defaults: offset 0, limit 50; ordering strictly newest-first.
    const page = await controller.getAnnouncements(MAYBANK.stockCode);
    // Wire-form check against the contract (ADR-0014): what the SPA receives.
    parseOrThrow(AnnouncementsPage, JSON.parse(JSON.stringify(page)));
    expect(page.total).toBe(3);
    expect(page.offset).toBe(0);
    expect(page.limit).toBe(50);
    expect(page.items.map((a) => a.title)).toEqual(
      MAYBANK_ANNOUNCEMENTS.map((a) => a.title), // seeded newest-first
    );

    // Item shape: straight from the entity, ISO filedAt, nullable passthroughs.
    expect(page.items[0]).toEqual({
      provenance: aggregatorRun.provenanceClass,
      category: AnnouncementCategory.FinancialResults,
      title: MAYBANK_ANNOUNCEMENTS[0].title,
      filedAt: '2026-09-28T10:00:00.000Z',
      sourceUrl: MAYBANK_ANNOUNCEMENTS[0].sourceUrl,
      aiSummary: MAYBANK_ANNOUNCEMENTS[0].aiSummary,
      aiSummaryAsOf: null,
    });
    expect(page.items[2].sourceUrl).toBeNull();
    expect(page.items[2].aiSummary).toBeNull();
    for (const item of page.items) {
      expect(item.provenance).toBe(ProvenanceClass.Aggregator);
    }

    // offset/limit window: items 1..1 of the newest-first order.
    const sliced = await controller.getAnnouncements(
      MAYBANK.stockCode,
      '1',
      '1',
    );
    expect(sliced).toMatchObject({ total: 3, offset: 1, limit: 1 });
    expect(sliced.items.map((a) => a.title)).toEqual([
      MAYBANK_ANNOUNCEMENTS[1].title,
    ]);

    // limit above the hard max is clamped (never 400); the resolved value echoes.
    const clamped = await controller.getAnnouncements(
      MAYBANK.stockCode,
      '0',
      '500',
    );
    expect(clamped.limit).toBe(MAX_PAGE_LIMIT);
    expect(clamped.total).toBe(3);

    // Negative offset clamps to 0.
    const negativeOffset = await controller.getAnnouncements(
      MAYBANK.stockCode,
      '-5',
      '10',
    );
    expect(negativeOffset.offset).toBe(0);
    expect(negativeOffset.items.length).toBe(3);
  });

  it('corporate-actions list: chronological exDate ascending, nullable amount, pagination', async () => {
    const page = await controller.getCorporateActions(MAYBANK.stockCode);
    // Wire-form check against the contract (ADR-0014): what the SPA receives.
    parseOrThrow(CorporateActionsPage, JSON.parse(JSON.stringify(page)));
    expect(page.total).toBe(3);
    expect(page.items.map((c) => c.exDate)).toEqual([
      '2025-12-05',
      '2026-03-05',
      '2026-06-12',
    ]);

    // Per-item shape: enum type, nullable amount passthrough, aggregator lineage.
    expect(page.items[0]).toEqual({
      provenance: ProvenanceClass.Aggregator,
      type: CorporateActionType.Dividend,
      exDate: '2025-12-05',
      amount: 0.3,
    });
    expect(page.items[1].type).toBe(CorporateActionType.Bonus);
    expect(page.items[1].amount).toBeNull();
    expect(typeof page.items[2].amount).toBe('number');

    // offset/limit window over the ascending order.
    const sliced = await controller.getCorporateActions(
      MAYBANK.stockCode,
      '2',
      '10',
    );
    expect(sliced).toMatchObject({ total: 3, offset: 2, limit: 10 });
    expect(sliced.items.map((c) => c.exDate)).toEqual(['2026-06-12']);
  });

  it('per-company list filters (spec 04): announcement ?category=, corporate-action ?type=', async () => {
    // One-or-more categories; invalid tokens dropped (never a 400).
    const dealings = await controller.getAnnouncements(
      MAYBANK.stockCode,
      '0',
      '10',
      'SHAREHOLDING_CHANGE,NOT_A_CATEGORY',
    );
    expect(dealings.total).toBe(1);
    expect(dealings.items[0].category).toBe(AnnouncementCategory.ShareholdingChange);
    expect(dealings.items[0].title).toBe(MAYBANK_ANNOUNCEMENTS[2].title);

    const multi = await controller.getAnnouncements(
      MAYBANK.stockCode,
      '0',
      '10',
      'ENTITLEMENT,SHAREHOLDING_CHANGE',
    );
    expect(multi.total).toBe(2);
    expect(new Set(multi.items.map((a) => a.category))).toEqual(
      new Set([AnnouncementCategory.Entitlement, AnnouncementCategory.ShareholdingChange]),
    );

    // No filter → all rows (cache keys differ per normalised filter).
    const all = await controller.getAnnouncements(MAYBANK.stockCode, '0', '10');
    expect(all.total).toBe(3);

    // Corporate-action type filter.
    const dividends = await controller.getCorporateActions(
      MAYBANK.stockCode,
      '0',
      '10',
      'DIVIDEND',
    );
    expect(dividends.total).toBe(2);
    expect(
      dividends.items.every((c) => c.type === CorporateActionType.Dividend),
    ).toBe(true);
    const unfiltered = await controller.getCorporateActions(
      MAYBANK.stockCode,
      '0',
      '10',
      'BOGUS',
    );
    expect(unfiltered.total).toBe(3); // all-invalid token → no filter
  });

  it('unknown code 404s on all three endpoints', async () => {
    const unknown = '9999';
    await expect(service.getCore(unknown)).rejects.toThrow(NotFoundException);
    await expect(
      service.getAnnouncements(unknown, 0, 50),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.getCorporateActions(unknown, 0, 50),
    ).rejects.toThrow(NotFoundException);
  });

  it('class-2 cache serves primed pages without re-query, and a 404 is never cached', async () => {
    // Prime (or hit the already-primed key from the composition test above).
    const before = await service.getCore(MAYBANK.stockCode);
    expect(
      await redis.get(`${STOCKS_CACHE_PREFIX}${MAYBANK.stockCode}:core`),
    ).not.toBeNull();
    const beforeAnnouncements = await service.getAnnouncements(
      MAYBANK.stockCode,
      0,
      50,
    );
    expect(beforeAnnouncements.total).toBe(3);

    // Mutate Postgres UNDER the cache: delete the fundamentals snapshot and
    // file a 4th announcement. A re-query would see both; the cached pages
    // must not.
    await dataSource
      .getRepository(FundamentalsSnapshot)
      .delete({ companyId: maybankCompanyId });
    await dataSource.getRepository(Announcement).save(
      dataSource.getRepository(Announcement).create({
        companyId: maybankCompanyId,
        category: AnnouncementCategory.General,
        title: 'Fourth announcement filed after priming',
        filedAt: new Date('2026-09-30T12:00:00Z'),
        sourceUrl: 'https://example-bursa-feed/1155/general',
        aiSummary: null,
        ingestionRunId: aggregatorRun.id,
      }),
    );

    const cachedCore = await service.getCore(MAYBANK.stockCode);
    expect(cachedCore).toEqual(before); // fundamentals still served
    expect(cachedCore.fundamentals).not.toBeNull();
    expect(cachedCore.fundamentals!.peRatio).toBe(18.3);

    const cachedAnnouncements = await service.getAnnouncements(
      MAYBANK.stockCode,
      0,
      50,
    );
    expect(cachedAnnouncements).toEqual(beforeAnnouncements); // total still 3
    expect(cachedAnnouncements.items.some((a) => a.title.includes('Fourth'))).toBe(
      false,
    );

    // A 404 must never poison a key: repeated unknown lookups stay uncached
    // (the exception propagates through the loader, `remember` skips the set).
    const unknownKey = `${STOCKS_CACHE_PREFIX}9999:core`;
    await expect(service.getCore('9999')).rejects.toThrow(NotFoundException);
    expect(await redis.get(unknownKey)).toBeNull();
    await expect(service.getCore('9999')).rejects.toThrow(NotFoundException);
    expect(await redis.get(unknownKey)).toBeNull();
  });

  it('series: KLCI-30 shape, empty points, bad query 400, outside-30 404', async () => {
    const series = await service.getSeries(MAYBANK.stockCode, '1d', '2y');
    parseOrThrow(StockSeriesResponse, JSON.parse(JSON.stringify(series)));
    expect(series.code).toBe(MAYBANK.stockCode);
    expect(series.interval).toBe('1d');
    expect(series.range).toBe('2y');
    expect(series.demoLabel).toBe('private-demo');
    expect(series.provenance).toBe(ProvenanceClass.Synthetic);
    expect(series.points).toHaveLength(3);
    expect(series.points[0]).toEqual({
      date: '2026-09-28',
      open: '9.750000',
      high: '10.100000',
      low: '9.700000',
      close: '9.800000',
      volume: '12300000',
    });

    const empty = await service.getSeries(CIMB.stockCode);
    parseOrThrow(StockSeriesResponse, JSON.parse(JSON.stringify(empty)));
    expect(empty.points).toEqual([]);
    expect(empty.provenance).toBe(ProvenanceClass.Real);

    await expect(service.getSeries(MAYBANK.stockCode, '1h', '2y')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.getSeries(MAYBANK.stockCode, '1d', '1y')).rejects.toThrow(
      BadRequestException,
    );

    await expect(service.getSeries(INARI.stockCode)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.getTechnicalAnalysis(INARI.stockCode)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.getSeries('9999')).rejects.toThrow(NotFoundException);
  });

  it('analysis thin: pending without row; ready + artifactPath; read-time stale; cost stripped', async () => {
    const pending = await service.getTechnicalAnalysis(MAYBANK.stockCode);
    parseOrThrow(
      StockTechnicalAnalysisResponse,
      JSON.parse(JSON.stringify(pending)),
    );
    expect(pending).toEqual({
      code: MAYBANK.stockCode,
      status: 'pending',
      headline: null,
      asOf: null,
      artifact: null,
      artifactPath: null,
      errorMessage: null,
      jobName: 'analyze-technical',
    });

    const faPending = await service.getFundamentalAnalysis(MAYBANK.stockCode);
    parseOrThrow(
      StockFundamentalAnalysisResponse,
      JSON.parse(JSON.stringify(faPending)),
    );
    expect(faPending.status).toBe('pending');
    expect(faPending.jobName).toBe('analyze-fundamental');

    const bucket = 'tuju-artifacts';
    const key = `analysis/technical/${MAYBANK.stockCode}.json`;
    const asOfBehind = new Date('2026-09-28T18:00:00.000Z');
    await dataSource.getRepository(TechnicalAnalysis).save(
      dataSource.getRepository(TechnicalAnalysis).create({
        instrumentId: maybankInstrumentId,
        status: StockAnalysisStatus.Ready,
        headline: 'SMA cross held',
        asOf: asOfBehind,
        artifactBucket: bucket,
        artifactKey: key,
        errorMessage: null,
        correlationId: randomUUID(),
        jobId: `analyze-technical:1D:${MAYBANK.stockCode}:2026-09-28`,
      }),
    );

    // Written behind the module's back, so announce it (the module's own
    // writes do; see analysis/stock-analysis.int-spec.ts).
    await readCache.changed({
      kind: 'stockAnalysisChanged',
      stockCode: MAYBANK.stockCode,
      analysis: 'technical',
    });

    const thin = await service.getTechnicalAnalysis(MAYBANK.stockCode);
    parseOrThrow(StockTechnicalAnalysisResponse, JSON.parse(JSON.stringify(thin)));
    expect(thin.status).toBe('stale');
    expect(thin.headline).toBe('SMA cross held');
    expect(thin.artifact).toEqual({ bucket, key });
    expect(thin.artifactPath).toBe(
      `/stocks/${MAYBANK.stockCode}/analysis/technical/artifact`,
    );

    const artifact = await service.getTechnicalArtifact(MAYBANK.stockCode);
    expect(artifact).not.toHaveProperty('cost');
    expect(artifact.schemaVersion).toBe('technical-analysis-1');
     expect(artifact.symbol).toBe('1155');

     await expect(
       service.getFundamentalArtifact(MAYBANK.stockCode),
     ).rejects.toThrow(NotFoundException);
   });

   it('analysis reference (ticket 08): returns all TA + FA facts for worker', async () => {
     // Fetch reference
     const ref = await service.getAnalysisReference(MAYBANK.stockCode);

     // Validate structure
     expect(ref.code).toBe('1155');
     expect(ref.shortName).toBe(MAYBANK.shortName);
     expect(ref.latestCloseDay).toBe('2026-09-30');
     expect(ref.asOfDatetime).toBeDefined();

     // TA facts
     expect(ref.technical.sma.p20).toBe(9.7);
     expect(ref.technical.sma.p50).toBe(9.55);
     expect(ref.technical.sma.p200).toBe(9.3);
     expect(ref.technical.rsi.period).toBe(14);
     expect(ref.technical.rsi.value).toBe(57.4);
     expect(ref.technical.macd.line).toBeCloseTo(0.02123, 4);
     expect(ref.technical.macd.signal).toBe(0.015);
     expect(ref.technical.macd.histogram).toBeCloseTo(0.00623, 4);
     expect(ref.technical.week52.high).toBe(10.45);
     expect(ref.technical.week52.low).toBe(8.32);
     expect(ref.technical.latestClose).toBe(10.02);

     // TA events: all 7
     expect(ref.technicalEvents).toHaveLength(7);
     const eventIds = ref.technicalEvents.map((e) => e.id);
     expect(eventIds).toContain('ma_cross_20_50');
     expect(eventIds).toContain('ma_cross_50_200');
     expect(eventIds).toContain('price_vs_sma');
     expect(eventIds).toContain('rsi_band');
     expect(eventIds).toContain('macd_cross');
     expect(eventIds).toContain('week52_proximity');
     expect(eventIds).toContain('broke_swing_high');

     // Event attributes (sample)
     const maXross = ref.technicalEvents.find((e) => e.id === 'ma_cross_20_50')!;
     expect(maXross.fired).toBe(true); // 9.7 > 9.55
     expect(maXross.at).toBe('2026-09-30');
     expect(maXross.values.sma20).toBe(9.7);
     expect(maXross.values.sma50).toBe(9.55);

     // FA metrics: exactly 9
     expect(ref.fundamental.metrics).toHaveLength(9);
     const metricIds = ref.fundamental.metrics.map((m) => m.id);
     expect(metricIds).toEqual([
       'trailing_pe',
       'dividend_yield',
       'roe',
       'debt_to_equity',
       'revenue_growth_qoq',
       'revenue_growth_yoy',
       'profit_growth_qoq',
       'profit_growth_yoy',
       'operating_cash_flow',
     ]);

      // FA metric scales: each metric declares its numeric convention (ticket 02)
      expect(ref.fundamental.metrics.map((m) => [m.id, m.unit, m.scale])).toEqual([
        ['trailing_pe', 'x', 'absolute'],
        ['dividend_yield', '%', 'fraction'],
        ['roe', '%', 'fraction'],
        ['debt_to_equity', 'x', 'absolute'],
        ['revenue_growth_qoq', '%', 'percentage_point'],
        ['revenue_growth_yoy', '%', 'percentage_point'],
        ['profit_growth_qoq', '%', 'percentage_point'],
        ['profit_growth_yoy', '%', 'percentage_point'],
        ['operating_cash_flow', 'RM bn', 'absolute'],
      ]);

     // Note: FA metric values depend on successful FundamentalsSnapshot ingestion
     // which will be validated when the full ingestion pipeline is wired
   });

   it('analysis reference: 404 for unknown code', async () => {
     await expect(
       service.getAnalysisReference('9999'),
     ).rejects.toThrow(NotFoundException);
   });

   it('analysis reference: 404 when no IndicatorSnapshot', async () => {
     // CIMB has no indicator snapshot
     await expect(
       service.getAnalysisReference(CIMB.stockCode),
     ).rejects.toThrow(NotFoundException);
   });

   it('analysis reference: 404 outside KLCI-30', async () => {
     // INARI is outside the 30-stock universe
     await expect(
       service.getAnalysisReference(INARI.stockCode),
     ).rejects.toThrow(NotFoundException);
   });


  /** Seed runs of each provenance class + the three companies and their graphs. */
  async function seedFixtures(): Promise<void> {
    realRefRun = await seedRun('PublicReferenceAdapter', ProvenanceClass.Real);
    realShariahRun = await seedRun('ShariahListAdapter', ProvenanceClass.Real);
    synthFundRun = await seedRun(
      'SyntheticFundamentalsAdapter',
      ProvenanceClass.Synthetic,
    );
    synthIndicatorRun = await seedRun(
      'SyntheticIndicatorAdapter',
      ProvenanceClass.Synthetic,
    );
    synthPriceRun = await seedRun(
      'SyntheticMarketDataAdapter',
      ProvenanceClass.Synthetic,
    );
    aggregatorRun = await seedRun(
      'AggregatorDisclosureAdapter',
      ProvenanceClass.Aggregator,
    );

    const sectorRepo = dataSource.getRepository(Sector);
    const sector = await sectorRepo.save(
      sectorRepo.create({
        name: 'Financial Services',
        subsector: 'Banks',
        ingestionRunId: realRefRun.id,
      }),
    );

    // MAYBANK: the full graph.
    const maybank = await seedListed(MAYBANK, sector.id);
    maybankCompanyId = maybank.companyId;
    maybankInstrumentId = maybank.instrumentId;
    if (process.env.DEBUG_REF) {
      console.log(
        'DEBUG SEED: After seedListed, maybank.companyId:',
        maybank.companyId,
      );
    }

    const fundRepo = dataSource.getRepository(FundamentalsSnapshot);
     const fundResult = await fundRepo.save(
       fundRepo.create({
         companyId: maybankCompanyId,
         ingestionRunId: synthFundRun.id,
         ...MAYBANK_FUNDAMENTALS,
       }),
     );
     if (process.env.DEBUG_REF) {
       console.log(
         'DEBUG SEED: Saved FundamentalsSnapshot:',
         fundResult.id,
         'companyId:',
         fundResult.companyId,
       );
     }

    const indicatorRepo = dataSource.getRepository(IndicatorSnapshot);
    await indicatorRepo.save(
      indicatorRepo.create({
        instrumentId: maybankInstrumentId,
        ingestionRunId: synthIndicatorRun.id,
        ...MAYBANK_INDICATOR,
      }),
    );

     const barRepo = dataSource.getRepository(PriceBar);
     for (const bar of MAYBANK_BARS) {
       await barRepo.save(
         barRepo.create({
           instrumentId: maybankInstrumentId,
           ingestionRunId: synthPriceRun.id,
           tradeDate: bar.tradeDate,
           open: '9.750000',
           high: '10.100000',
           low: '9.700000',
           close: bar.close,
           volume: '12300000',
         }),
       );
     }

     // Latest 2 quarters for growth metrics.
     const quarterRepo = dataSource.getRepository(QuarterlyFinancials);
     for (const quarter of MAYBANK_QUARTERS) {
       await quarterRepo.save(
         quarterRepo.create({
           companyId: maybankCompanyId,
           ingestionRunId: synthFundRun.id,
           ...quarter,
         }),
       );
     }

     // Two shariah records — the later effectiveDate must win.
    const shariahRepo = dataSource.getRepository(ShariahStatus);
    await shariahRepo.save([
      shariahRepo.create({
        companyId: maybankCompanyId,
        ingestionRunId: realShariahRun.id,
        status: ShariahComplianceStatus.NonCompliant,
        effectiveDate: '2025-05-30',
      }),
      shariahRepo.create({
        companyId: maybankCompanyId,
        ingestionRunId: realShariahRun.id,
        status: ShariahComplianceStatus.Compliant,
        effectiveDate: '2025-11-28',
      }),
    ]);

    const announcementRepo = dataSource.getRepository(Announcement);
    await announcementRepo.save(
      MAYBANK_ANNOUNCEMENTS.map((a) =>
        announcementRepo.create({
          companyId: maybankCompanyId,
          ingestionRunId: aggregatorRun.id,
          ...a,
        }),
      ),
    );

    const actionRepo = dataSource.getRepository(CorporateAction);
    await actionRepo.save(
      MAYBANK_CORPORATE_ACTIONS.map((c) =>
        actionRepo.create({
          companyId: maybankCompanyId,
          ingestionRunId: aggregatorRun.id,
          ...c,
        }),
      ),
    );

    // AXIATA: the loss-maker (ttmEps < 0, stored P/E null).
    const axiata = await seedListed(AXIATA, sector.id);
    await fundRepo.save(
      fundRepo.create({
        companyId: axiata.companyId,
        ingestionRunId: synthFundRun.id,
        sharesOutstanding: '3600000000',
        ntaPerShare: '2.100000',
        ttmEps: '-0.083400',
        ttmRevenue: '19800000000.00',
        ttmNetProfit: '-80000000.00',
        peRatio: null,
        dividendYield: null,
        pntaRatio: '2.110000',
        roe: '-0.021000',
        debtToEquity: '1.420000',
        psr: '1.900000',
        consecutiveGrowthQuarters: 0,
      }),
    );

    // CIMB: sparse — identity only.
    await seedListed(CIMB, sector.id);

    // INARI: seeded but outside KLCI 30 (hard-gate 404 on PoC routes).
    await seedListed(INARI, sector.id);
  }

  /** Seed one listed company + its ordinary-share instrument (real lineage). */
  async function seedListed(
    ref: ReferenceCompany,
    sectorId: string,
  ): Promise<{ companyId: string; instrumentId: string }> {
    const companyRepo = dataSource.getRepository(Company);
    const company = await companyRepo.save(
      companyRepo.create({
        fullName: ref.fullName,
        board: ref.board,
        aliases: [...ref.aliases],
        sectorId,
        ingestionRunId: realRefRun.id,
      }),
    );
    if (process.env.DEBUG_REF) {
      console.log('DEBUG SEED: Created company:', company.id, 'for:', ref.stockCode);
    }

    const instrumentRepo = dataSource.getRepository(Instrument);
    const instrument = await instrumentRepo.save(
      instrumentRepo.create({
        stockCode: ref.stockCode,
        shortName: ref.shortName,
        fullName: ref.fullName,
        companyId: company.id,
        ingestionRunId: realRefRun.id,
      }),
    );
    if (process.env.DEBUG_REF) {
      console.log(
        'DEBUG SEED: Created instrument:',
        instrument.id,
        'with companyId:',
        instrument.companyId,
      );
    }

    return { companyId: company.id, instrumentId: instrument.id };
  }

  /**
   * Open one ingestion run of the given provenance class. Raw INSERT — the
   * STI discriminator footgun (repo.save stamps `kind` with the class name,
   * an invalid enum label) — same reason as `IngestionRunService.openRun`.
   */
  async function seedRun(
    adapter: string,
    provenanceClass: ProvenanceClass,
  ): Promise<IngestionRun> {
    const rows = await dataSource.query(
      `INSERT INTO ingestion_runs (kind, adapter, provenance_class, ran_at)
       VALUES ('standard', $1, $2, $3)
       RETURNING id`,
      [adapter, provenanceClass, new Date()],
    );
    const id = rows[0].id as string;
    return dataSource.getRepository(IngestionRun).findOneByOrFail({ id });
  }
});
