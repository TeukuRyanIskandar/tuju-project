/**
 * Disclosure read-surface integration test (spec 04; ticket 02; ADR-0011).
 *
 * Exercises the spec's externally-observable behaviours against REAL infra via
 * testcontainers (throwaway Postgres + Redis) — not mocks, because what is
 * decided here (feed filtering/ordering/pagination, the dealings view being
 * the same rows, the two derived calendars' windows and linkages, the
 * tagged/market news split, per-row aggregator lineage, class-2 read-through
 * caching, the decision-B purge removing every row) is exactly what a mock
 * silently gets wrong:
 *
 *   1. Market feed: `filedAt` desc, one-or-more category filter, companyCode
 *      + from/to filters, pagination clamping, unknown code → empty page.
 *   2. Dealings view: the feed's `SHAREHOLDING_CHANGE` rows — the same rows.
 *   3. Corporate-actions calendar: default window 7 back/+30 ahead on
 *      `exDate`, ordered ascending, type + companyCode filters.
 *   4. Results calendar: when-filed (backward-looking), linked to the
 *      FINANCIAL_RESULTS announcement, `reportedAt` desc; quarters with no
 *      filing are not on the calendar.
 *   5. News: company feed = tagged rows with matchedAlias; market feed =
 *      untagged rows only.
 *   6. Every row is `aggregator` lineage; the decision-B purge removes them
 *      all (incl. the cascading tags) and sweeps the cache prefix.
 *   7. Class-2 cache: primed pages served without re-query.
 *
 * Seeding is direct (NOT via the ingest) — same posture as
 * `stocks.int.spec.ts` prior art; runs in the default `test` lane, Docker
 * required (see `ingestion.int.spec.ts`).
 */

import { MarketAnnouncementsPage, AnnouncementDetail, CorporateActionCalendarWindow, ResultsCalendarWindow, NewsPage, parseOrThrow } from '@tuju/contracts';
import { randomUUID } from 'node:crypto';
import IORedis, { type Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Worker } from 'bullmq';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import type { JobEnvelope, JobResult } from '@tuju/contracts';

import { REDIS_CLIENT } from '../redis/redis.module';
import { ReadCacheService } from '../cache/read-cache.service';
import { DISCLOSURES_CACHE_PREFIX } from '../cache/cache-keys';
import { JobBus } from '../jobbus/job-bus.service';
import { ANALYSIS_QUEUE, JobNames } from '../jobbus/job-names';
import {
  Announcement,
  AnalysisResult,
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
import { InitialSchema1727600000000 } from '../data/migrations/1727600000000-InitialSchema';
import { FreeTierDomainModel1727700000000 } from '../data/migrations/1727700000000-FreeTierDomainModel';
import { ReIngestNaturalKeys1727800000000 } from '../data/migrations/1727800000000-ReIngestNaturalKeys';
import { DisclosureReadModel1727900000000 } from '../data/migrations/1727900000000-DisclosureReadModel';
import { MarketIndexModel1728000000000 } from '../data/migrations/1728000000000-MarketIndexModel';
import {
  AnnouncementCategory,
  CorporateActionType,
  ListingBoard,
  ProvenanceClass,
} from '../data/entities/enums';
import { PurgeService } from '../ingestion/purge.service';

import { AnnouncementSummaryStore } from './announcement-summary.store';
import { DisclosuresController } from './disclosures.controller';
import { DisclosuresService } from './disclosures.service';
import { MAX_PAGE_LIMIT } from '../stocks/pagination';

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

const MAYBANK = '1155';
const CIMB = '1023';
const AXIATA = '6888';

/** The "today" the now-relative fixtures are seeded against. */
const NOW = new Date();
const isoDay = (offsetDays: number): string =>
  new Date(NOW.getTime() + offsetDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
const at = (offsetDays: number, hourUtc = 9): Date =>
  new Date(`${isoDay(offsetDays)}T${String(hourUtc).padStart(2, '0')}:00:00.000Z`);

describe('Disclosures read surface (integration — testcontainers)', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let dataSource: DataSource;
  let redis: Redis;

  let controller: DisclosuresController;
  let service: DisclosuresService;
  let purge: PurgeService;
  let jobBus: JobBus;
  let announcementSummaryStore: AnnouncementSummaryStore;

  let aggregatorRun: IngestionRun;
  let syntheticRun: IngestionRun;
  let realRefRun: IngestionRun;
  let maybankCompanyId: string;

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
      controllers: [DisclosuresController],
      providers: [
        { provide: DataSource, useValue: dataSource },
        { provide: REDIS_CLIENT, useValue: redis },
        ReadCacheService,
        DisclosuresService,
        PurgeService,
        JobBus,
        AnnouncementSummaryStore,
      ],
    }).compile();

    controller = moduleRef.get(DisclosuresController);
    service = moduleRef.get(DisclosuresService);
    purge = moduleRef.get(PurgeService);
    jobBus = moduleRef.get(JobBus);
    announcementSummaryStore = moduleRef.get(AnnouncementSummaryStore);
    await jobBus.onModuleInit();
    announcementSummaryStore.onModuleInit();

    await seedFixtures();
  });

  afterAll(async () => {
    await jobBus?.onModuleDestroy();
    await redis?.quit();
    if (dataSource?.isInitialized) await dataSource.destroy();
    await redisContainer?.stop();
    await pgContainer?.stop();
  });

  it('market feed: filedAt desc, per-item shape with aggregator lineage, pagination clamps', async () => {
    const page = await controller.getAnnouncements();
    // Wire-form check against the contract (ADR-0014): what the SPA receives.
    parseOrThrow(MarketAnnouncementsPage, JSON.parse(JSON.stringify(page)));
    // MAYBANK rows only (CIMB/AXIATA seeded sparse): newest-first order.
    expect(page.total).toBe(5);
    expect(page.offset).toBe(0);
    expect(page.limit).toBe(50);
    expect(page.items.map((a) => a.title)).toEqual([
      'Dealing in listed shares by director', // now−2d
      'Single tier interim dividend', // now−4d
      'Dealing in listed shares by director (late)', // now−9d
      'Quarterly report Q2 FY2026', // filed now−30d
      'Quarterly report Q1 FY2026', // filed now−120d
    ]);

    // Per-item shape: flat rows carry the category field (no grouped payload).
    expect(page.items[0]).toEqual({
      provenance: ProvenanceClass.Aggregator,
      companyCode: MAYBANK,
      companyName: 'Malayan Banking Berhad',
      category: AnnouncementCategory.ShareholdingChange,
      title: 'Dealing in listed shares by director',
      filedAt: at(-2).toISOString(),
      sourceUrl: 'https://example.test/1155/dealing',
      aiSummary: null,
      aiSummaryAsOf: null,
    });
    for (const item of page.items) {
      expect(item.provenance).toBe(ProvenanceClass.Aggregator);
      expect(typeof item.filedAt).toBe('string');
    }

    // limit above the hard max clamps (never 400); resolved value echoes.
    const clamped = await controller.getAnnouncements(
      undefined,
      undefined,
      undefined,
      undefined,
      '0',
      '500',
    );
    expect(clamped.limit).toBe(MAX_PAGE_LIMIT);

    // offset window over the newest-first order.
    const sliced = await controller.getAnnouncements(
      undefined,
      undefined,
      undefined,
      undefined,
      '1',
      '2',
    );
    expect(sliced).toMatchObject({ total: 5, offset: 1, limit: 2 });
    expect(sliced.items.map((a) => a.title)).toEqual([
      'Single tier interim dividend',
      'Dealing in listed shares by director (late)',
    ]);
  });

  it('market feed: one-or-more category filter, companyCode, from/to window, unknown code → empty page', async () => {
    // One-or-more categories; invalid tokens dropped.
    const dealings = await controller.getAnnouncements(
      'SHAREHOLDING_CHANGE,NOT_A_CATEGORY',
    );
    expect(dealings.total).toBe(2);
    expect(
      dealings.items.every(
        (a) => a.category === AnnouncementCategory.ShareholdingChange,
      ),
    ).toBe(true);

    const multi = await controller.getAnnouncements(
      'ENTITLEMENT,SHAREHOLDING_CHANGE',
    );
    expect(multi.total).toBe(3);

    // companyCode filter (the code lives on the instrument, resolved server-side).
    const maybank = await controller.getAnnouncements(
      undefined,
      MAYBANK,
    );
    expect(maybank.total).toBe(5);

    // from: only rows filed from now−5d on.
    const recent = await controller.getAnnouncements(
      undefined,
      undefined,
      isoDay(-5),
    );
    expect(recent.items.map((a) => a.title)).toEqual([
      'Dealing in listed shares by director',
      'Single tier interim dividend',
    ]);

    // to: only rows filed on/before now−5d.
    const older = await controller.getAnnouncements(
      undefined,
      undefined,
      undefined,
      isoDay(-5),
    );
    expect(older.items.map((a) => a.title)).toEqual([
      'Dealing in listed shares by director (late)',
      'Quarterly report Q2 FY2026',
      'Quarterly report Q1 FY2026',
    ]);
    // An invalid date bound is ignored (clamp, never 400).
    const forgiving = await controller.getAnnouncements(
      undefined,
      undefined,
      'not-a-date',
    );
    expect(forgiving.total).toBe(5);

    // Supplied-but-unknown companyCode is filter semantics → empty page.
    const unknown = await controller.getAnnouncements(undefined, '9999');
    expect(unknown).toEqual({ items: [], total: 0, offset: 0, limit: 50 });
  });

  it('dealings view: the feed filtered to SHAREHOLDING_CHANGE — the same rows', async () => {
    const dealings = await controller.getDealings();
    // Wire-form check against the contract (ADR-0014): what the SPA receives.
    parseOrThrow(MarketAnnouncementsPage, JSON.parse(JSON.stringify(dealings)));
    const filtered = await controller.getAnnouncements('SHAREHOLDING_CHANGE');
    expect(dealings).toEqual(filtered);
    expect(dealings.total).toBe(2);
    expect(dealings.items[0].category).toBe(AnnouncementCategory.ShareholdingChange);

    // companyCode + from/to pass through to the same view.
    const scoped = await controller.getDealings(MAYBANK, isoDay(-5));
    expect(scoped.items.map((a) => a.title)).toEqual([
      'Dealing in listed shares by director',
    ]);
  });

  it('corporate-actions calendar: default window 7 back/+30 ahead on exDate, ordered ascending, type/company filters', async () => {
    const calendar = await controller.getCorporateActionCalendar();
    // Wire-form check against the contract (ADR-0014): what the SPA receives.
    parseOrThrow(CorporateActionCalendarWindow, JSON.parse(JSON.stringify(calendar)));
    // Default window: [now−7, now+30]; echoes the resolved bounds.
    expect(calendar.from).toBe(isoDay(-7));
    expect(calendar.to).toBe(isoDay(30));
    expect(calendar.items.map((c) => [c.companyCode, c.type, c.exDate])).toEqual([
      [MAYBANK, CorporateActionType.Bonus, isoDay(-3)], // inside (7 back)
      [CIMB, CorporateActionType.Dividend, isoDay(5)], // inside
      [MAYBANK, CorporateActionType.Dividend, isoDay(10)], // inside
      // SPLIT (+40) and RIGHTS (−15) sit outside the default window.
    ]);

    // Per-item shape: nullable amount passthrough, aggregator lineage.
    expect(calendar.items[0]).toEqual({
      provenance: ProvenanceClass.Aggregator,
      companyCode: MAYBANK,
      companyName: 'Malayan Banking Berhad',
      type: CorporateActionType.Bonus,
      exDate: isoDay(-3),
      amount: null,
    });
    expect(calendar.items[2].amount).toBe(0.3);
    expect(typeof calendar.items[2].amount).toBe('number');

    // Explicit window includes the out-of-default rows.
    const wide = await controller.getCorporateActionCalendar(
      isoDay(-30),
      isoDay(60),
    );
    expect(wide.items.map((c) => c.type)).toEqual([
      CorporateActionType.Rights,
      CorporateActionType.Bonus,
      CorporateActionType.Dividend,
      CorporateActionType.Dividend,
      CorporateActionType.Split,
    ]);

    // Type filter (one-or-more) + companyCode filter.
    const dividends = await controller.getCorporateActionCalendar(
      undefined,
      undefined,
      'DIVIDEND',
    );
    expect(dividends.items.map((c) => c.companyCode)).toEqual([CIMB, MAYBANK]);
    const maybankOnly = await controller.getCorporateActionCalendar(
      undefined,
      undefined,
      undefined,
      MAYBANK,
    );
    expect(maybankOnly.items.map((c) => c.companyCode)).toEqual([
      MAYBANK,
      MAYBANK,
    ]);
  });

  it('results calendar: backward-looking when-filed, linked to the FINANCIAL_RESULTS announcement, reportedAt desc', async () => {
    const calendar = await controller.getResultsCalendar();
    // Wire-form check against the contract (ADR-0014): what the SPA receives.
    parseOrThrow(ResultsCalendarWindow, JSON.parse(JSON.stringify(calendar)));
    // MAYBANK Q2 + Q1 (filed), AXIATA quarter has NO filing → not on the
    // when-filed calendar (its quarter exists in QuarterlyFinancials).
    expect(calendar.items.length).toBe(2);
    expect(calendar.from).toBeNull();
    expect(calendar.to).toBeNull();

    const [q2, q1] = calendar.items;
    expect(q2).toEqual({
      provenance: ProvenanceClass.Aggregator,
      companyCode: MAYBANK,
      companyName: 'Malayan Banking Berhad',
      fiscalYear: 2026,
      fiscalQuarter: 2,
      periodEnd: isoDay(-75),
      reportedAt: at(-30).toISOString(),
      announcement: {
        title: 'Quarterly report Q2 FY2026',
        filedAt: at(-30).toISOString(),
        sourceUrl: null,
      },
    });
    expect(q1.reportedAt).toBe(at(-120).toISOString());
    expect(q1.fiscalQuarter).toBe(1);
    expect(q1.periodEnd).toBe(isoDay(-165));

    // from/to filter on reportedAt (when results were filed).
    const sinceCut = await controller.getResultsCalendar(isoDay(-60));
    expect(sinceCut.items.map((i) => i.fiscalQuarter)).toEqual([2]);
    const upToCut = await controller.getResultsCalendar(undefined, isoDay(-60));
    expect(upToCut.items.map((i) => i.fiscalQuarter)).toEqual([1]);

    // companyCode scope.
    const maybank = await controller.getResultsCalendar(undefined, undefined, MAYBANK);
    expect(maybank.items.length).toBe(2);
    const axiata = await controller.getResultsCalendar(undefined, undefined, AXIATA);
    expect(axiata.items).toEqual([]);
  });

  it('news feed: company-tagged rows with matchedAlias; market feed = untagged rows only', async () => {
    const maybankNews = await controller.getNews(MAYBANK);
    // Wire-form check against the contract (ADR-0014): what the SPA receives.
    parseOrThrow(NewsPage, JSON.parse(JSON.stringify(maybankNews)));
    expect(maybankNews.total).toBe(3);
    expect(maybankNews.items.map((n) => n.headline)).toEqual([
      'Maybank posts record profit', // now−1h
      'Maybank declares dividend', // now−3h
      'MBB wins mandate', // now−5h (tagged via a curated alias)
    ]);
    expect(maybankNews.items[2]).toEqual({
      provenance: ProvenanceClass.Aggregator,
      headline: 'MBB wins mandate',
      url: 'https://example.test/news/maybank-mandate',
      source: 'Demo Wire',
      publishedAt: expect.any(String),
      matchedAlias: 'MBB',
    });
    expect(maybankNews.items[0].matchedAlias).toBe('MAYBANK');

    // Market feed: ONLY untagged rows (conservative-tagging fallout).
    const market = await controller.getNews();
    // Wire-form check against the contract (ADR-0014): what the SPA receives.
    parseOrThrow(NewsPage, JSON.parse(JSON.stringify(market)));
    expect(market.items.map((n) => n.headline)).toEqual([
      'Bursa Malaysia closes higher',
      'Ringgit firms against the dollar',
    ]);
    for (const item of market.items) {
      expect(item.matchedAlias).toBeUndefined();
      expect(item.provenance).toBe(ProvenanceClass.Aggregator);
    }

    // Pagination over the company feed.
    const sliced = await controller.getNews(MAYBANK, '1', '1');
    expect(sliced).toMatchObject({ total: 3, offset: 1, limit: 1 });
    expect(sliced.items.map((n) => n.headline)).toEqual([
      'Maybank declares dividend',
    ]);

    // Unknown companyCode → empty page (filter semantics).
    const unknown = await controller.getNews('9999');
    expect(unknown).toEqual({ items: [], total: 0, offset: 0, limit: 50 });
  });

  it('class-2 cache: primed pages served without re-query', async () => {
    const before = await service.getMarketAnnouncements({
      offset: 0,
      limit: 50,
      from: null,
      to: null,
    });
    const primedKeys = await redis.keys(
      `${DISCLOSURES_CACHE_PREFIX}announcements:*`,
    );
    expect(primedKeys.length).toBeGreaterThan(0);
    expect(before.total).toBe(5);

    // Mutate Postgres UNDER the cache — the cached page must not see it.
    await dataSource.getRepository(Announcement).save(
      dataSource.getRepository(Announcement).create({
        companyId: maybankCompanyId,
        category: AnnouncementCategory.General,
        title: 'Filed after priming',
        filedAt: at(0),
        sourceUrl: null,
        aiSummary: null,
        aiSummaryAsOf: null,
        ingestionRunId: aggregatorRun.id,
      }),
    );

    const cached = await service.getMarketAnnouncements({
      offset: 0,
      limit: 50,
      from: null,
      to: null,
    });
    expect(cached).toEqual(before);
    expect(cached.total).toBe(5); // the fresh row is NOT served
  });

  it('GET /announcements/:id — one announcement\'s own fields; malformed/unknown id both 404 (spec 06, ticket 03)', async () => {
    const row = await dataSource.getRepository(Announcement).findOneOrFail({
      where: { title: 'Dealing in listed shares by director' },
    });

    const detail = await controller.getAnnouncementById(row.id);
    // Wire-form check against the contract (ADR-0014): what the SPA receives.
    parseOrThrow(AnnouncementDetail, JSON.parse(JSON.stringify(detail)));
    expect(detail).toEqual({
      id: row.id,
      provenance: ProvenanceClass.Aggregator,
      companyCode: MAYBANK,
      companyName: 'Malayan Banking Berhad',
      category: AnnouncementCategory.ShareholdingChange,
      title: 'Dealing in listed shares by director',
      filedAt: at(-2).toISOString(),
      sourceUrl: 'https://example.test/1155/dealing',
      aiSummary: null,
      aiSummaryAsOf: null,
    });

    await expect(controller.getAnnouncementById('not-a-uuid')).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      controller.getAnnouncementById('00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(NotFoundException);
  });

  it('AnnouncementSummaryStore: a summarize-announcement JobResult writes aiSummary/aiSummaryAsOf (spec 06, ticket 03)', async () => {
    const row = await dataSource.getRepository(Announcement).findOneOrFail({
      where: { title: 'Single tier interim dividend' },
    });

    const worker = new Worker(
      ANALYSIS_QUEUE,
      async (): Promise<JobResult> => ({
        correlationId: randomUUID(),
        jobId: `ann:${row.id}`,
        pointer: {
          bucket: 'tuju-artifacts',
          key: `analysis/announcement/${row.id}/2026-09-29T05.json`,
          sha256: 'a'.repeat(64),
          bytes: 64,
          contentType: 'application/json',
        },
        summary: {
          headline: 'Malayan Banking Berhad declared a dividend',
          asOf: '2026-09-29T05:00:00.000Z',
        },
        at: new Date().toISOString(),
      }),
      { connection: redis },
    );

    try {
      const envelope: JobEnvelope<{ announcementId: string }> = {
        correlationId: randomUUID(),
        requestedBy: 'system',
        trigger: 'system',
        asOf: '2026-09-29T05:00:00.000Z',
        payload: { announcementId: row.id },
      } as JobEnvelope<{ announcementId: string }>;
      // Content-derived + announcement-scoped, independent of asOf (ADR-0007
      // §2): the BullMQ dedup key the enqueue-time collapse relies on.
      const { jobId } = await jobBus.enqueue(JobNames.announcementSummary, envelope);
      expect(jobId).toBe(`ann-${row.id}`);

      let updated = await dataSource.getRepository(Announcement).findOneByOrFail({ id: row.id });
      for (let i = 0; i < 100 && updated.aiSummary === null; i++) {
        await new Promise((r) => setTimeout(r, 50));
        updated = await dataSource.getRepository(Announcement).findOneByOrFail({ id: row.id });
      }

      expect(updated.aiSummary).toBe('Malayan Banking Berhad declared a dividend');
      expect(updated.aiSummaryAsOf).toBeInstanceOf(Date);
      // Confirmed through the read surface too (spec 04's existing aiSummary field).
      const viaFeed = await controller.getAnnouncementById(row.id);
      expect(viaFeed.aiSummary).toBe('Malayan Banking Berhad declared a dividend');
    } finally {
      await worker.close();
    }
  });

  it('AnnouncementSummaryStore: a legitimate re-summarize overwrites cleanly, not duplicating state (spec 06, ticket 03)', async () => {
    const row = await dataSource.getRepository(Announcement).findOneOrFail({
      where: { title: 'Single tier interim dividend' },
    });
    // Precondition: the prior test already wrote a summary for this row.
    const before = await dataSource.getRepository(Announcement).findOneByOrFail({ id: row.id });
    expect(before.aiSummary).toBe('Malayan Banking Berhad declared a dividend');
    const countBefore = await dataSource.getRepository(Announcement).count();

    const worker = new Worker(
      ANALYSIS_QUEUE,
      async (): Promise<JobResult> => ({
        correlationId: randomUUID(),
        jobId: `ann:${row.id}`,
        pointer: {
          bucket: 'tuju-artifacts',
          key: `analysis/announcement/${row.id}/2026-09-30T05.json`,
          sha256: 'b'.repeat(64),
          bytes: 64,
          contentType: 'application/json',
        },
        summary: {
          // Simulates a correction: the same announcement, a different headline.
          headline: 'Malayan Banking Berhad declared a REVISED dividend',
          asOf: '2026-09-30T05:00:00.000Z',
        },
        at: new Date().toISOString(),
      }),
      { connection: redis },
    );

    try {
      // A distinct BullMQ job id (the prior one was already removed on
      // completion) carrying the SAME `ann:{id}` JobResult.jobId — models a
      // legitimate later re-summarize, same as the market-brief re-run test.
      await jobBus.getQueue().add(
        JobNames.announcementSummary,
        {
          correlationId: randomUUID(),
          requestedBy: 'system',
          trigger: 'system',
          asOf: '2026-09-30T05:00:00.000Z',
          payload: { announcementId: row.id },
        },
        { jobId: `ann-${row.id}-correction` },
      );

      let updated = before;
      for (
        let i = 0;
        i < 100 && updated.aiSummary === before.aiSummary;
        i++
      ) {
        await new Promise((r) => setTimeout(r, 50));
        updated = await dataSource.getRepository(Announcement).findOneByOrFail({ id: row.id });
      }

      // Overwritten in place — one row, the new headline, no duplicate state.
      expect(updated.aiSummary).toBe(
        'Malayan Banking Berhad declared a REVISED dividend',
      );
      expect(await dataSource.getRepository(Announcement).count()).toBe(countBefore);
    } finally {
      await worker.close();
    }
  });

  it('decision-B purge removes every aggregator/synthetic row (incl. the derived tags) and sweeps the cache prefix', async () => {
    await redis.set(`${DISCLOSURES_CACHE_PREFIX}announcements:stale`, 'stale');
    await redis.set('cache:untouched', 'keep-me');

    const result = await purge.purgeUnlicensed();

    expect(result.announcements).toBeGreaterThan(0);
    expect(result.corporateActions).toBeGreaterThan(0);
    expect(result.newsArticles).toBeGreaterThan(0);
    expect(await dataSource.getRepository(Announcement).count()).toBe(0);
    expect(await dataSource.getRepository(CorporateAction).count()).toBe(0);
    expect(await dataSource.getRepository(NewsArticle).count()).toBe(0);
    expect(await dataSource.getRepository(NewsArticleTag).count()).toBe(0); // cascaded
    expect(await dataSource.getRepository(QuarterlyFinancials).count()).toBe(0); // synthetic lineage

    // Real reference rows survive (companies/instruments are `real`).
    expect(await dataSource.getRepository(Company).count()).toBe(3);
    expect(await dataSource.getRepository(Instrument).count()).toBe(3);

    // The cache prefix was swept (before these reads re-cache empty pages);
    // keys outside it survive.
    expect(
      await redis.keys(`${DISCLOSURES_CACHE_PREFIX}*`),
    ).toEqual([]);
    expect(await redis.get('cache:untouched')).toBe('keep-me');

    // Every feed is now empty; unknown and known codes behave the same.
    expect((await controller.getAnnouncements()).items).toEqual([]);
    expect((await controller.getDealings()).items).toEqual([]);
    expect((await controller.getNews()).items).toEqual([]);
    expect(
      (await controller.getCorporateActionCalendar()).items,
    ).toEqual([]);
    expect((await controller.getResultsCalendar()).items).toEqual([]);
  });

  /** Seed one aggregator run + one synthetic run + real reference lineage + three companies and their graphs. */
  async function seedFixtures(): Promise<void> {
    aggregatorRun = await seedRun('AggregatorDisclosureAdapter', ProvenanceClass.Aggregator);
    syntheticRun = await seedRun('SyntheticFundamentalsAdapter', ProvenanceClass.Synthetic);
    realRefRun = await seedRun('PublicReferenceAdapter', ProvenanceClass.Real);

    const sectorRepo = dataSource.getRepository(Sector);
    const sector = await sectorRepo.save(
      sectorRepo.create({
        name: 'Financial Services',
        subsector: 'Banks',
        ingestionRunId: realRefRun.id,
      }),
    );

    maybankCompanyId = (
      await seedListed(MAYBANK, 'MAYBANK', 'Malayan Banking Berhad', ['Maybank', 'MBB'], sector.id)
    ).companyId;
    await seedListed(CIMB, 'CIMB', 'CIMB Group Holdings Berhad', ['CIMB Group'], sector.id);
    await seedListed(AXIATA, 'AXIATA', 'Axiata Group Berhad', ['Axiata'], sector.id);

    // --- MAYBANK announcements (aggregator): results ×2 + entitlement + dealings ×2.
    const announcementRepo = dataSource.getRepository(Announcement);
    await announcementRepo.save(
      [
        {
          category: AnnouncementCategory.FinancialResults,
          title: 'Quarterly report Q1 FY2026',
          filedAt: at(-120), // ~45d after the Q1 period end
          sourceUrl: null,
        },
        {
          category: AnnouncementCategory.FinancialResults,
          title: 'Quarterly report Q2 FY2026',
          filedAt: at(-30), // ~45d after the Q2 period end
          sourceUrl: null,
        },
        {
          category: AnnouncementCategory.Entitlement,
          title: 'Single tier interim dividend',
          filedAt: at(-4),
          sourceUrl: 'https://example.test/1155/dividend',
        },
        {
          category: AnnouncementCategory.ShareholdingChange,
          title: 'Dealing in listed shares by director',
          filedAt: at(-2),
          sourceUrl: 'https://example.test/1155/dealing',
        },
        {
          category: AnnouncementCategory.ShareholdingChange,
          title: 'Dealing in listed shares by director (late)',
          filedAt: at(-9),
          sourceUrl: null,
        },
      ].map((a) =>
        announcementRepo.create({
          companyId: maybankCompanyId,
          ingestionRunId: aggregatorRun.id,
          aiSummary: null,
          aiSummaryAsOf: null,
          ...a,
        }),
      ),
    );

    // --- Corporate actions around the default calendar window.
    const actionRepo = dataSource.getRepository(CorporateAction);
    const cimbCompanyId = (
      await dataSource.getRepository(Instrument).findOneByOrFail({ stockCode: CIMB })
    ).companyId;
    await actionRepo.save([
      actionRepo.create({
        companyId: maybankCompanyId,
        type: CorporateActionType.Dividend,
        exDate: isoDay(10),
        amount: '0.300000',
        ingestionRunId: aggregatorRun.id,
      }),
      actionRepo.create({
        companyId: maybankCompanyId,
        type: CorporateActionType.Bonus,
        exDate: isoDay(-3),
        amount: null,
        ingestionRunId: aggregatorRun.id,
      }),
      actionRepo.create({
        companyId: maybankCompanyId,
        type: CorporateActionType.Split,
        exDate: isoDay(40),
        amount: null,
        ingestionRunId: aggregatorRun.id,
      }),
      actionRepo.create({
        companyId: maybankCompanyId,
        type: CorporateActionType.Rights,
        exDate: isoDay(-15),
        amount: '0.150000',
        ingestionRunId: aggregatorRun.id,
      }),
      actionRepo.create({
        companyId: cimbCompanyId,
        type: CorporateActionType.Dividend,
        exDate: isoDay(5),
        amount: '0.060000',
        ingestionRunId: aggregatorRun.id,
      }),
    ]);

    // --- Quarterly financials (synthetic lineage) + the results-calendar linkage.
    const quarterlyRepo = dataSource.getRepository(QuarterlyFinancials);
    const axiataCompanyId = (
      await dataSource.getRepository(Instrument).findOneByOrFail({ stockCode: AXIATA })
    ).companyId;
    await quarterlyRepo.save([
      quarterlyRepo.create({
        companyId: maybankCompanyId,
        fiscalYear: 2026,
        fiscalQuarter: 1,
        periodEnd: isoDay(-165),
        revenue: '12000000000.00',
        netProfit: '1000000000.00',
        eps: '0.115000',
        equity: '80000000000.00',
        nta: '75000000000.00',
        intangibles: '5000000000.00',
        totalBorrowings: '70000000000.00',
        ingestionRunId: syntheticRun.id,
      }),
      quarterlyRepo.create({
        companyId: maybankCompanyId,
        fiscalYear: 2026,
        fiscalQuarter: 2,
        periodEnd: isoDay(-75),
        revenue: '12500000000.00',
        netProfit: '1100000000.00',
        eps: '0.126000',
        equity: '81000000000.00',
        nta: '76000000000.00',
        intangibles: '5000000000.00',
        totalBorrowings: '69000000000.00',
        ingestionRunId: syntheticRun.id,
      }),
      // AXIATA quarter with NO filed announcement → not on the when-filed calendar.
      quarterlyRepo.create({
        companyId: axiataCompanyId,
        fiscalYear: 2026,
        fiscalQuarter: 1,
        periodEnd: isoDay(-165),
        revenue: '5000000000.00',
        netProfit: '400000000.00',
        eps: '0.111000',
        equity: '30000000000.00',
        nta: '28000000000.00',
        intangibles: '1000000000.00',
        totalBorrowings: '25000000000.00',
        ingestionRunId: syntheticRun.id,
      }),
    ]);

    // --- News: 3 MAYBANK-tagged + 2 untagged market rows, publishedAt desc.
    const articleRepo = dataSource.getRepository(NewsArticle);
    const articles = await articleRepo.save([
      articleRepo.create({
        headline: 'Maybank posts record profit',
        url: 'https://example.test/news/maybank-profit',
        source: 'Demo Wire',
        publishedAt: at(0, 5),
        ingestionRunId: aggregatorRun.id,
      }),
      articleRepo.create({
        headline: 'Bursa Malaysia closes higher',
        url: 'https://example.test/news/bursa-closes',
        source: 'Demo Wire',
        publishedAt: at(0, 4),
        ingestionRunId: aggregatorRun.id,
      }),
      articleRepo.create({
        headline: 'Maybank declares dividend',
        url: 'https://example.test/news/maybank-dividend',
        source: 'Demo Wire',
        publishedAt: at(0, 3),
        ingestionRunId: aggregatorRun.id,
      }),
      articleRepo.create({
        headline: 'Ringgit firms against the dollar',
        url: 'https://example.test/news/ringgit-firms',
        source: 'Demo Wire',
        publishedAt: at(0, 2),
        ingestionRunId: aggregatorRun.id,
      }),
      articleRepo.create({
        headline: 'MBB wins mandate',
        url: 'https://example.test/news/maybank-mandate',
        source: 'Demo Wire',
        publishedAt: at(0, 1),
        ingestionRunId: aggregatorRun.id,
      }),
    ]);
    const byHeadline = new Map(articles.map((a) => [a.headline, a.id]));
    const tagRepo = dataSource.getRepository(NewsArticleTag);
    await tagRepo.save([
      tagRepo.create({
        newsArticleId: byHeadline.get('Maybank posts record profit')!,
        companyId: maybankCompanyId,
        matchedAlias: 'MAYBANK',
      }),
      tagRepo.create({
        newsArticleId: byHeadline.get('Maybank declares dividend')!,
        companyId: maybankCompanyId,
        matchedAlias: 'Maybank',
      }),
      tagRepo.create({
        newsArticleId: byHeadline.get('MBB wins mandate')!,
        companyId: maybankCompanyId,
        matchedAlias: 'MBB',
      }),
    ]);
  }

  /** Seed one listed company + its ordinary-share instrument (real lineage). */
  async function seedListed(
    stockCode: string,
    shortName: string,
    fullName: string,
    aliases: string[],
    sectorId: string,
  ): Promise<{ companyId: string; instrumentId: string }> {
    const companyRepo = dataSource.getRepository(Company);
    const company = await companyRepo.save(
      companyRepo.create({
        fullName,
        board: ListingBoard.Main,
        aliases,
        sectorId,
        ingestionRunId: realRefRun.id,
      }),
    );

    const instrumentRepo = dataSource.getRepository(Instrument);
    const instrument = await instrumentRepo.save(
      instrumentRepo.create({
        stockCode,
        shortName,
        fullName,
        companyId: company.id,
        ingestionRunId: realRefRun.id,
      }),
    );

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
