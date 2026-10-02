/**
 * Ingestion worker integration test (ticket 04 Testing seam; ADR-0011).
 *
 * Exercises the ticket's three highest-value behaviours against REAL infra via
 * testcontainers (throwaway Postgres + Redis, the same stack ADR-0006 runs in
 * compose) — not mocks, because what is decided here (rows FK'd to the correct
 * IngestionRun lineage, indicators/ratios materialised in Postgres, the Redis-only
 * intraday posture, the by-lineage decision-B purge) is exactly what a mock
 * silently gets wrong:
 *
 *   1. A nightly ingest lands price/fundamentals snapshots AND per-instrument
 *      indicator rows in Postgres.
 *   2. Intraday replay writes to Redis ONLY — Postgres row counts do not change.
 *   3. The decision-B purge deletes exactly the synthetic/aggregator rows and
 *      leaves the real reference data + the lineage rows intact.
 *   4. A SECOND nightly against a populated DB is idempotent (ticket 05): rows
 *      update in place on their natural keys — no duplicate-key failure, no
 *      duplicate rows, lineage accumulates.
 *
 * This is a `.spec.ts` (runs in the default `test` lane per ticket 04) but requires
 * Docker for testcontainers; the ticket guarantees Docker is available.
 */
import IORedis, { type Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

import { AdaptersModule } from '../data/adapters/adapters.module';
import { REDIS_CLIENT } from '../redis/redis.module';
import { ReadCacheService } from '../cache/read-cache.service';
import { AnalysisResult } from '../data/entities/analysis-result.entity';
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
  MarketIndexKind,
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
import { ProvenanceClass } from '../data/entities/enums';

import { EodIngestService } from './eod-ingest.service';
import { IngestionRunService } from './ingestion-run.service';
import { ReferenceDataService } from './reference-data.service';
import { IntradayReplayService, INTRADAY_KEY_PREFIX } from './intraday-replay.service';
import { PurgeService } from './purge.service';
import { REFERENCE_UNIVERSE } from './reference-universe';

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

describe('IngestionWorker (integration — testcontainers)', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let dataSource: DataSource;
  let redis: Redis;

  let eod: EodIngestService;
  let intraday: IntradayReplayService;
  let purge: PurgeService;

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
      imports: [AdaptersModule],
      providers: [
        { provide: DataSource, useValue: dataSource },
        { provide: REDIS_CLIENT, useValue: redis },
        IngestionRunService,
        ReferenceDataService,
        ReadCacheService,
        EodIngestService,
        IntradayReplayService,
        PurgeService,
      ],
    }).compile();

    eod = moduleRef.get(EodIngestService);
    intraday = moduleRef.get(IntradayReplayService);
    purge = moduleRef.get(PurgeService);
  });

  afterAll(async () => {
    await redis?.quit();
    if (dataSource?.isInitialized) await dataSource.destroy();
    await redisContainer?.stop();
    await pgContainer?.stop();
  });

  it('nightly ingest lands price/fundamentals snapshots + per-instrument indicator rows', async () => {
    const result = await eod.runNightly();

    const universe = REFERENCE_UNIVERSE.length;

    // Reference universe seeded (real provenance).
    expect(await dataSource.getRepository(Instrument).count()).toBe(universe);
    expect(await dataSource.getRepository(Company).count()).toBe(universe);

    // Synthetic price + fundamentals landed.
    expect(result.priceBars).toBeGreaterThan(universe * 700); // ~750/instrument
    expect(await dataSource.getRepository(PriceBar).count()).toBe(result.priceBars);
    expect(result.quarterlyRows).toBe(universe * 12); // 12 quarters each

    // One fundamentals snapshot per company, one indicator snapshot per instrument.
    expect(result.fundamentalsSnapshots).toBe(universe);
    expect(result.indicatorSnapshots).toBe(universe);
    expect(await dataSource.getRepository(FundamentalsSnapshot).count()).toBe(universe);
    expect(await dataSource.getRepository(IndicatorSnapshot).count()).toBe(universe);

    // Indicator rows are warmed (SMA-200 non-null over ~750 bars) and 52-wk set.
    const snapshots = await dataSource.getRepository(IndicatorSnapshot).find();
    for (const s of snapshots) {
      expect(s.sma20).not.toBeNull();
      expect(s.sma200).not.toBeNull();
      expect(s.rsi14).not.toBeNull();
      expect(s.macd).not.toBeNull();
      expect(s.week52High).not.toBeNull();
      expect(s.week52Low).not.toBeNull();
      expect(Number(s.week52High)).toBeGreaterThanOrEqual(Number(s.week52Low));
    }

    // Materialised ratios present (P/E may be null for a loss-maker, but the
    // reconciled default params are profitable, so P/E is set here).
    const fund = await dataSource.getRepository(FundamentalsSnapshot).find();
    for (const f of fund) {
      expect(f.peRatio).not.toBeNull();
      expect(f.pntaRatio).not.toBeNull();
      expect(Number(f.ttmRevenue)).toBeGreaterThan(0);
    }

    // Aggregator + real rows also landed (used by the purge test). The demo
    // snapshot (spec 04, ticket 01) files 11 disclosures + 5 corporate actions
    // per company and 10 headlines.
    expect(result.announcements).toBe(universe * 11);
    expect(result.corporateActions).toBe(universe * 5);
    expect(result.newsArticles).toBe(10);
    expect(result.shariahStatuses).toBe(universe);
    expect(result.ipoListings).toBe(1);

    // Cap-weighted index series landed (spec 05, ticket 02): one headline +
    // one per Sector WITH constituents - the curated universe spans 4 of the
    // 5 reference sectors ('Consumer Products & Services' has none, so no row).
    const sectorCount = new Set(
      REFERENCE_UNIVERSE.map((c) => c.sectorName),
    ).size;
    expect(result.marketIndices).toBe(sectorCount + 1);
    expect(result.indexLevels).toBe(
      (sectorCount + 1) * (result.priceBars / universe),
    );
    expect(await dataSource.getRepository(MarketIndex).count()).toBe(
      result.marketIndices,
    );
    expect(await dataSource.getRepository(IndexLevel).count()).toBe(
      result.indexLevels,
    );

    // The headline series opens at the 100-point base, ordered by date, and
    // carries run lineage (the join the read surface labels "illustrative" via).
    const headlineIndex = await dataSource
      .getRepository(MarketIndex)
      .findOneByOrFail({ kind: MarketIndexKind.Headline });
    const levelRepo = dataSource.getRepository(IndexLevel);
    const headlineLevels = await levelRepo.find({
      where: { indexId: headlineIndex.id },
      order: { levelDate: 'ASC' },
    });
    expect(headlineLevels).toHaveLength(result.indexLevels / (sectorCount + 1));
    expect(headlineLevels[0].level).toBe('100.000000');
    const withRun = await levelRepo.findOne({
      where: { id: headlineLevels[0].id },
      relations: { ingestionRun: true },
    });
    expect(withRun!.ingestionRun.provenanceClass).toBe(ProvenanceClass.Synthetic);

    // Deterministic ticker-tagging (spec 04 §2): 5 shortName hits + 1 curated
    // alias hit (TNB) + 2 tags for the multi-company headline = 8 tags; the
    // substring non-match (TenagaX) and the market-level rows stay untagged.
    expect(result.newsArticleTags).toBe(8);
    expect(
      await dataSource.getRepository(NewsArticleTag).count(),
    ).toBe(result.newsArticleTags);

    const tagRepo = dataSource.getRepository(NewsArticleTag);
    const maybank = await dataSource
      .getRepository(Company)
      .findOneByOrFail({ fullName: 'Malayan Banking Berhad' });
    // A shortName headline is tagged, with the shortName as matchedAlias.
    const maybankTag = await tagRepo.findOneByOrFail({
      companyId: maybank.id,
    });
    expect(maybankTag.matchedAlias).toBe('MAYBANK');
    const maybankArticle = await dataSource
      .getRepository(NewsArticle)
      .findOneByOrFail({ id: maybankTag.newsArticleId });
    expect(maybankArticle.headline).toBe('MAYBANK posts record quarterly profit');
    // The multi-company headline tags both companies.
    const multi = await dataSource
      .getRepository(NewsArticle)
      .findOneByOrFail({ headline: 'Maybank and CIMB lead banks higher' });
    const multiTags = await tagRepo.find({ where: { newsArticleId: multi.id } });
    expect(multiTags.length).toBe(2);
    // A substring non-match is not tagged (market-level).
    const tenagaX = await dataSource
      .getRepository(NewsArticle)
      .findOneByOrFail({ headline: 'New fintech platform TenagaX launches' });
    expect(await tagRepo.count({ where: { newsArticleId: tenagaX.id } })).toBe(0);
    // A market-level row has no tags at all.
    const market = await dataSource
      .getRepository(NewsArticle)
      .findOneByOrFail({ headline: 'Bursa Malaysia closes higher on regional rally' });
    expect(await tagRepo.count({ where: { newsArticleId: market.id } })).toBe(0);

    // Every sourced row FKs an IngestionRun (lineage), and a SyntheticRun exists.
    const syntheticRuns = await dataSource
      .getRepository(SyntheticRun)
      .count();
    expect(syntheticRuns).toBeGreaterThanOrEqual(1);
  });

  it('intraday replay writes to Redis only, never Postgres', async () => {
    // Snapshot Postgres row counts across ALL tables before the replay.
    const before = await tableCounts(dataSource);

    const ticks = await intraday.replayTick(new Date('2025-06-02T04:00:00Z'));
    expect(ticks.length).toBe(REFERENCE_UNIVERSE.length);

    // Redis holds a tick per instrument (the disposable intraday layer).
    const keys = await redis.keys(`${INTRADAY_KEY_PREFIX}:*`);
    expect(keys.length).toBe(REFERENCE_UNIVERSE.length);
    const oneTick = await intraday.lastTick(REFERENCE_UNIVERSE[0].stockCode);
    expect(oneTick).not.toBeNull();
    expect(Number(oneTick!.price)).toBeGreaterThan(0);

    // Postgres is byte-for-byte unchanged — intraday never lands there.
    const after = await tableCounts(dataSource);
    expect(after).toEqual(before);
  });

  it('decision-B purge deletes exactly synthetic/aggregator rows, keeping real + lineage', async () => {
    // State after the nightly ingest above: synthetic (prices/fundamentals/
    // indicators), aggregator (announcements/actions/news), real (reference +
    // shariah + ipo) all present.
    const runsBefore = await dataSource.getRepository(IngestionRun).count();

    const realBefore = {
      instruments: await dataSource.getRepository(Instrument).count(),
      companies: await dataSource.getRepository(Company).count(),
      sectors: await dataSource.getRepository(Sector).count(),
      shariah: await dataSource.getRepository(ShariahStatus).count(),
      ipo: await dataSource.getRepository(IpoListing).count(),
    };

    const res = await purge.purgeUnlicensed();

    // Synthetic + aggregator DATA rows are gone — including the derived news
    // tags, which cascade with their aggregator articles (spec 04).
    expect(await dataSource.getRepository(PriceBar).count()).toBe(0);
    expect(await dataSource.getRepository(QuarterlyFinancials).count()).toBe(0);
    expect(await dataSource.getRepository(FundamentalsSnapshot).count()).toBe(0);
    expect(await dataSource.getRepository(IndicatorSnapshot).count()).toBe(0);
    expect(await dataSource.getRepository(Announcement).count()).toBe(0);
    expect(await dataSource.getRepository(CorporateAction).count()).toBe(0);
    expect(await dataSource.getRepository(NewsArticle).count()).toBe(0);
    expect(await dataSource.getRepository(NewsArticleTag).count()).toBe(0);
    expect(await dataSource.getRepository(IndexLevel).count()).toBe(0);
    expect(await dataSource.getRepository(MarketIndex).count()).toBe(0);
    expect(res.priceBars).toBeGreaterThan(0);
    expect(res.announcements).toBeGreaterThan(0);
    expect(res.indexLevels).toBeGreaterThan(0);

    // Real reference data survives untouched.
    expect(await dataSource.getRepository(Instrument).count()).toBe(realBefore.instruments);
    expect(await dataSource.getRepository(Company).count()).toBe(realBefore.companies);
    expect(await dataSource.getRepository(Sector).count()).toBe(realBefore.sectors);
    expect(await dataSource.getRepository(ShariahStatus).count()).toBe(realBefore.shariah);
    expect(await dataSource.getRepository(IpoListing).count()).toBe(realBefore.ipo);

    // Lineage rows themselves survive (targeted delete, no go-live debt).
    expect(await dataSource.getRepository(IngestionRun).count()).toBe(runsBefore);

    // And no `real` run was in the purge set (only synthetic/aggregator runs).
    const remainingByClass = await dataSource
      .getRepository(IngestionRun)
      .createQueryBuilder('r')
      .select('r.provenance_class', 'cls')
      .addSelect('COUNT(*)', 'n')
      .groupBy('r.provenance_class')
      .getRawMany<{ cls: ProvenanceClass; n: string }>();
    const realRuns = remainingByClass.find((c) => c.cls === ProvenanceClass.Real);
    expect(realRuns).toBeDefined();
  });

  it('nightly ingest + purge invalidate the class-2 read cache after commit (ticket 01)', async () => {
    // Seed stale class-2 keys the way the read endpoints will, plus a key
    // outside both invalidation prefixes that must survive.
    await redis.set('cache:search:1155:20', 'stale');
    await redis.set('cache:stocks:1155:core', 'stale');
    await redis.set('cache:disclosures:announcements', 'stale');
    await redis.set('cache:screener:screen', 'stale');
    await redis.set('cache:market:overview', 'stale');
    await redis.set('cache:untouched', 'keep-me');

    // A second nightly ingest: data commits, then both prefixes are swept.
    // The purge above removed the synthetic/aggregator rows (safe re-land) but
    // KEPT the `real` manual rows (shariah + IPO) — since ticket 05 the nightly
    // is idempotent on natural keys, so the demo adapters' static snapshots
    // upsert those rows in place (no pre-clear shim needed any more).
    const result = await eod.runNightly();
    expect(result.indicatorSnapshots).toBe(REFERENCE_UNIVERSE.length);
    expect(await redis.get('cache:search:1155:20')).toBeNull();
    expect(await redis.get('cache:stocks:1155:core')).toBeNull();
    expect(await redis.get('cache:disclosures:announcements')).toBeNull();
    expect(await redis.get('cache:screener:screen')).toBeNull();
    expect(await redis.get('cache:market:overview')).toBeNull();
    expect(await redis.get('cache:untouched')).toBe('keep-me');

    // The decision-B purge sweeps the same prefixes after its commit.
    await redis.set('cache:stocks:1023:core', 'stale');
    await redis.set('cache:search:maybnk:20', 'stale');
    await redis.set('cache:disclosures:news', 'stale');
    await redis.set('cache:screener:fields', 'stale');
    await redis.set('cache:market:indices', 'stale');
    const purged = await purge.purgeUnlicensed();
    expect(purged.priceBars).toBeGreaterThan(0);
    expect(await redis.get('cache:stocks:1023:core')).toBeNull();
    expect(await redis.get('cache:search:maybnk:20')).toBeNull();
    expect(await redis.get('cache:disclosures:news')).toBeNull();
    expect(await redis.get('cache:screener:fields')).toBeNull();
    expect(await redis.get('cache:market:indices')).toBeNull();
  });

  it('a second nightly against a populated DB is idempotent (ticket 05)', async () => {
    // The purge in the previous test removed the synthetic/aggregator rows, so
    // run 1 re-lands them against the populated reference + `real` rows.
    const run1 = await eod.runNightly();
    const counts1 = await tableCounts(dataSource);
    const runs1 = counts1.ingestionRun;
    // Row ids before run 2 — the natural-key upserts must update in place,
    // never mint fresh rows (ticket 02 AC: "stable ids").
    const idsOf = async (
      entity: typeof MarketIndex | typeof IndexLevel,
    ): Promise<string[]> =>
      (await dataSource.getRepository(entity).find({ select: { id: true } }))
        .map((r) => r.id)
        .sort();
    const indexIds1 = await idsOf(MarketIndex);
    const levelIds1 = await idsOf(IndexLevel);

    // Run 2 — the exact same ingest, unmodified, against a fully populated DB.
    // Before ticket 05 this failed the whole transaction at persistShariah
    // (duplicate key on UQ_shariah_statuses_company_effective) and, past that,
    // at the snapshot tables and the silent-duplication tables.
    const run2 = await eod.runNightly();
    const counts2 = await tableCounts(dataSource);

    // The adapter output is identical, so the result summaries agree...
    expect(run2).toEqual(run1);

    // ...and every DATA table holds exactly the same rows — no duplicates, no
    // losses (the new natural-key unique constraints make re-landing the same
    // snapshot an update-in-place instead of a second copy).
    expect(counts2.priceBar).toBe(counts1.priceBar);
    expect(counts2.quarterly).toBe(counts1.quarterly);
    expect(counts2.fundamentals).toBe(counts1.fundamentals);
    expect(counts2.indicator).toBe(counts1.indicator);
    expect(counts2.announcement).toBe(counts1.announcement);
    expect(counts2.corporateAction).toBe(counts1.corporateAction);
    expect(counts2.news).toBe(counts1.news);
    expect(counts2.newsTag).toBe(counts1.newsTag);
    expect(counts2.shariah).toBe(counts1.shariah);
    expect(counts2.ipo).toBe(counts1.ipo);
    expect(counts2.marketIndex).toBe(counts1.marketIndex);
    expect(counts2.indexLevel).toBe(counts1.indexLevel);
    // Same rows, not just same counts — ids are unchanged across the re-ingest.
    expect(await idsOf(MarketIndex)).toEqual(indexIds1);
    expect(await idsOf(IndexLevel)).toEqual(levelIds1);

    // Still exactly one current snapshot per company / instrument.
    const universe = REFERENCE_UNIVERSE.length;
    expect(counts2.fundamentals).toBe(universe);
    expect(counts2.indicator).toBe(universe);

    // Lineage accumulates per nightly on purpose (option B audit trail): one
    // fresh run row each for public-reference, synthetic, disclosure, news,
    // shariah, ipo, and index.
    expect(counts2.ingestionRun).toBe(runs1 + 7);
  });
});

/** Count rows across every domain table (order-stable object for deep-equality). */
async function tableCounts(ds: DataSource): Promise<Record<string, number>> {
  const entities: [string, new () => object][] = [
    ['ingestionRun', IngestionRun],
    ['sector', Sector],
    ['company', Company],
    ['instrument', Instrument],
    ['priceBar', PriceBar],
    ['quarterly', QuarterlyFinancials],
    ['fundamentals', FundamentalsSnapshot],
    ['indicator', IndicatorSnapshot],
    ['corporateAction', CorporateAction],
    ['shariah', ShariahStatus],
    ['announcement', Announcement],
    ['news', NewsArticle],
    ['newsTag', NewsArticleTag],
    ['ipo', IpoListing],
    ['marketIndex', MarketIndex],
    ['indexLevel', IndexLevel],
  ];
  const out: Record<string, number> = {};
  for (const [name, entity] of entities) {
    out[name] = await ds.getRepository(entity).count();
  }
  return out;
}
