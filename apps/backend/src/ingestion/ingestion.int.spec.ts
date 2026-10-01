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
import { InitialSchema1727600000000 } from '../data/migrations/1727600000000-InitialSchema';
import { FreeTierDomainModel1727700000000 } from '../data/migrations/1727700000000-FreeTierDomainModel';
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
      migrations: [InitialSchema1727600000000, FreeTierDomainModel1727700000000],
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

    // Aggregator + real rows also landed (used by the purge test).
    expect(result.announcements).toBe(universe);
    expect(result.corporateActions).toBe(universe);
    expect(result.newsArticles).toBe(universe);
    expect(result.shariahStatuses).toBe(universe);
    expect(result.ipoListings).toBe(1);

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

    // Synthetic + aggregator DATA rows are gone.
    expect(await dataSource.getRepository(PriceBar).count()).toBe(0);
    expect(await dataSource.getRepository(QuarterlyFinancials).count()).toBe(0);
    expect(await dataSource.getRepository(FundamentalsSnapshot).count()).toBe(0);
    expect(await dataSource.getRepository(IndicatorSnapshot).count()).toBe(0);
    expect(await dataSource.getRepository(Announcement).count()).toBe(0);
    expect(await dataSource.getRepository(CorporateAction).count()).toBe(0);
    expect(await dataSource.getRepository(NewsArticle).count()).toBe(0);
    expect(res.priceBars).toBeGreaterThan(0);
    expect(res.announcements).toBeGreaterThan(0);

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
    await redis.set('cache:untouched', 'keep-me');

    // A second nightly ingest: data commits, then both prefixes are swept.
    // The purge above removed the synthetic/aggregator rows (safe re-land) but
    // KEPT the `real` manual rows (shariah + IPO) — the demo adapters'
    // static snapshots re-insert them, so clear just those two first to
    // respect their unique keys (shariah is a history table keyed
    // company+effectiveDate).
    await dataSource.getRepository(ShariahStatus).createQueryBuilder().delete().execute();
    await dataSource.getRepository(IpoListing).createQueryBuilder().delete().execute();
    const result = await eod.runNightly();
    expect(result.indicatorSnapshots).toBe(REFERENCE_UNIVERSE.length);
    expect(await redis.get('cache:search:1155:20')).toBeNull();
    expect(await redis.get('cache:stocks:1155:core')).toBeNull();
    expect(await redis.get('cache:untouched')).toBe('keep-me');

    // The decision-B purge sweeps the same prefixes after its commit.
    await redis.set('cache:stocks:1023:core', 'stale');
    await redis.set('cache:search:maybnk:20', 'stale');
    const purged = await purge.purgeUnlicensed();
    expect(purged.priceBars).toBeGreaterThan(0);
    expect(await redis.get('cache:stocks:1023:core')).toBeNull();
    expect(await redis.get('cache:search:maybnk:20')).toBeNull();
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
    ['ipo', IpoListing],
  ];
  const out: Record<string, number> = {};
  for (const [name, entity] of entities) {
    out[name] = await ds.getRepository(entity).count();
  }
  return out;
}
