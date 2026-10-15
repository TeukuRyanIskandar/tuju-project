/**
 * Search endpoint integration test (ticket 02 Testing seam; ADR-0011).
 *
 * Exercises the ticket's highest-value behaviours against REAL infra via
 * testcontainers (throwaway Postgres + Redis) — not mocks, because what is
 * decided here (the pg_trgm rank bands over the joined universe, the
 * class-2 cache) is exactly what a mock silently gets wrong:
 *
 *   1. Table-driven rank-band ordering: exact code → code prefix → name
 *      prefix (shortName over fullName, case-insensitive) → fuzzy
 *      similarity; first band with hits wins; LEAP rows are unsearchable.
 *   2. Endpoint behaviours through the composed SearchModule: query
 *      normalisation, empty-query short-circuit, limit clamping.
 *   3. Class-2 read-through caching: the second identical (case/whitespace
 *      variant) call is served without re-querying, one cache key per
 *      normalised query:limit.
 *
 * Seeds the curated demo universe (`REFERENCE_UNIVERSE`) plus the fixture
 * rows the band tests need: a LEAP company (unsearchable), a fullName-prefix
 * competitor (must rank BELOW a shortName hit), and a name-prefix "115"
 * competitor (must lose to the code-prefix band).
 *
 * This is a `.spec.ts` (runs in the default `test` lane per ticket 02) but
 * requires Docker for testcontainers; the ticket guarantees Docker is
 * available.
 */
import { SearchResponse, parseOrThrow } from '@tuju/contracts';
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
import { SEARCH_CACHE_PREFIX } from '../cache';
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
import { ListingBoard, ProvenanceClass } from '../data/entities/enums';
import { InitialSchema1727600000000 } from '../data/migrations/1727600000000-InitialSchema';
import { FreeTierDomainModel1727700000000 } from '../data/migrations/1727700000000-FreeTierDomainModel';
import { IngestionRunService } from '../ingestion/ingestion-run.service';
import { REFERENCE_UNIVERSE } from '../ingestion/reference-universe';
import { REQUIRES_JOB_KEY } from '../auth/requires-job.decorator';

import {
  INSTRUMENT_SEARCH,
  type InstrumentSearch,
  type SearchResultRow,
} from './instrument-search.interface';
import { PgInstrumentSearch } from './instrument-search.pg';
import { SearchController } from './search.controller';
import { SearchModule } from './search.module';
import { SearchService } from './search.service';

jest.setTimeout(180_000);

// Full entity list (mirrors ingestion.int.spec.ts / DataModule) so the
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

/**
 * Extra fixture rows beyond the reference universe, one per band behaviour
 * under test (board + names chosen so each band case has a clear winner).
 */
const EXTRA_FIXTURES: readonly SeedEntry[] = [
  // fullName-prefix competitor: searching "CIMB" hits it via fullName only,
  // so it must rank BELOW the shortName hit (1023).
  {
    stockCode: '5182',
    shortName: 'CPOINT',
    fullName: 'Cimbpoint Capital Berhad',
    board: ListingBoard.Main,
    sectorName: 'Financial Services',
  },
  // name-prefix competitor: its fullName starts with "115", a "better" name
  // match than anything else — it must still lose to the code-prefix band.
  {
    stockCode: '7000',
    shortName: 'ONECAP',
    fullName: '115 Capital Berhad',
    board: ListingBoard.Main,
    sectorName: 'Financial Services',
  },
  // LEAP row: exists in the reference tables but is outside the analysed
  // universe — never searchable by code or name (prefix or fuzzy).
  {
    stockCode: '8001',
    shortName: 'LEAPCO',
    fullName: 'Leap Market Capital Berhad',
    board: ListingBoard.Leap,
    sectorName: 'Technology',
  },
];

interface SeedEntry {
  stockCode: string;
  shortName: string;
  fullName: string;
  board: ListingBoard;
  sectorName: string;
  aliases?: readonly string[];
}

// Module-scope harness state (the helpers below run inside beforeAll).
let pgContainer: StartedPostgreSqlContainer;
let redisContainer: StartedRedisContainer;
let dataSource: DataSource;

// Table-driven rank-band cases (read at describe-evaluation time).
const RANKING_CASES: readonly { query: string; expectedCodes: string[] }[] = [
  // Band 1: exact code, always first (and alone — the code is unique).
  { query: '1155', expectedCodes: ['1155'] },
  // Band 2 beats name matches: "115" hits 1155's code prefix, so the
  // name-prefix competitor (7000, fullName "115 Capital Berhad") never shows.
  { query: '115', expectedCodes: ['1155'] },
  // Band 3: name prefix, case-insensitive, shortName hit over fullName hit.
  { query: 'CIMB', expectedCodes: ['1023', '5182'] },
  { query: 'cimb', expectedCodes: ['1023', '5182'] },
  // Band 3 via fullName only still finds the row.
  { query: 'MALAYAN', expectedCodes: ['1155'] },
  // ACE-board ordinary shares are searchable (INARI 0200 is ACE).
  { query: 'INARI', expectedCodes: ['0200'] },
  // Band 4: fuzzy similarity still finds the misspelled names.
  { query: 'maybnk', expectedCodes: ['1155'] },
  { query: 'CIMBB', expectedCodes: ['1023'] },
  // LEAP rows are never searchable — by code, short name or fuzzy name.
  { query: '8001', expectedCodes: [] },
  { query: 'LEAPCO', expectedCodes: [] },
  { query: 'leap market', expectedCodes: [] },
  // LIKE metacharacters in the query match literally — `1_5` must NOT
  // wildcard-match 1155 (band 2 escapes % and _).
  { query: '1_5', expectedCodes: [] },
  { query: '1%5', expectedCodes: [] },
];

describe('Search endpoint (integration — testcontainers)', () => {
  let moduleRef: TestingModule;
  let redis: Redis;

  /** Repo-level seam under test (separate instance: ranking tests bypass cache). */
  let pgSearch: PgInstrumentSearch;
  /** The composed module's controller + a spy on the seam impl (cache tests). */
  let controller: SearchController;
  let service: SearchService;
  let searchSpy: jest.SpyInstance;

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

    await seedUniverse();

    // Boot the REAL SearchModule (ConfigModule → env URLs, RedisModule → the
    // shared client, DataModule → its own DataSource against the same
    // container) — the "composes" seam, no schedule/worker bits.
    moduleRef = await bootModule();
    controller = moduleRef.get(SearchController);
    service = moduleRef.get(SearchService);
    redis = moduleRef.get<Redis>(REDIS_CLIENT);
    searchSpy = jest.spyOn(
      moduleRef.get<InstrumentSearch>(INSTRUMENT_SEARCH),
      'search',
    );

    // Ranking tests drive the seam directly over the seeding DataSource.
    pgSearch = new PgInstrumentSearch(dataSource);
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

  // --- rank bands (repo seam, real pg_trgm) ---------------------------------

  it.each(RANKING_CASES)('$query → $expectedCodes', async ({ query, expectedCodes }) => {
    const rows = await pgSearch.search(query, 20);
    expect(rows.map((r) => r.stockCode)).toEqual(expectedCodes);
  });

  it('result rows carry the full joined identity shape (strings only)', async () => {
    const [row] = await pgSearch.search('1155', 20);
    expect(row).toEqual({
      stockCode: '1155',
      shortName: 'MAYBANK',
      fullName: 'Malayan Banking Berhad',
      companyName: 'Malayan Banking Berhad',
      board: 'MAIN',
      sectorName: 'Financial Services',
    } satisfies SearchResultRow);
  });

  it('the limit caps the returned band rows', async () => {
    // "C" hits the name-prefix band (CIMB + CPOINT short, Cimbpoint full);
    // limit 1 returns only the top row.
    const rows = await pgSearch.search('C', 1);
    expect(rows.map((r) => r.stockCode)).toEqual(['1023']);
  });

  // --- endpoint behaviours (composed SearchModule) --------------------------

  it('empty / whitespace-only query returns an empty result without querying', async () => {
    const callsBefore = searchSpy.mock.calls.length;
    expect(await controller.search('   ')).toEqual({ query: '', items: [] });
    expect(await controller.search(undefined)).toEqual({ query: '', items: [] });
    expect(searchSpy.mock.calls.length).toBe(callsBefore);
  });

  it('identical queries hit the class-2 cache: case/whitespace variants share one key and are not re-queried', async () => {
    const callsBefore = searchSpy.mock.calls.length;

    const first = await controller.search('  CIMB  ');
    expect(first.query).toBe('CIMB');
    expect(first.items.map((r) => r.stockCode)).toEqual(['1023', '5182']);
    expect(searchSpy.mock.calls.length).toBe(callsBefore + 1);

    // Same normalised query, different case → same cache key → cache hit.
    const second = await controller.search('cimb');
    expect(second.query).toBe('cimb');
    expect(second.items).toEqual(first.items);
    expect(searchSpy.mock.calls.length).toBe(callsBefore + 1);

    // Exactly one class-2 key, keyed on the normalised (case-folded) query.
    const keys = await redis.keys(`${SEARCH_CACHE_PREFIX}*`);
    expect(keys).toEqual([`${SEARCH_CACHE_PREFIX}cimb:20`]);
  });

  it('limit= clamps (default 20, hard max 100, invalid → default), never errors', async () => {
    await controller.search('zz500', '500');
    expect(searchSpy).toHaveBeenLastCalledWith('zz500', 100);
    await controller.search('zz0', '0');
    expect(searchSpy).toHaveBeenLastCalledWith('zz0', 20);
    await controller.search('zzabc', 'abc');
    expect(searchSpy).toHaveBeenLastCalledWith('zzabc', 20);
    await controller.search('zznone');
    expect(searchSpy).toHaveBeenLastCalledWith('zznone', 20);
  });

  it('SearchModule composes: controller + service resolve, the route is anonymous, no schedule bits', async () => {
    expect(controller).toBeInstanceOf(SearchController);
    expect(service).toBeInstanceOf(SearchService);

    // Anonymous (ADR-0005): no @RequiresJob metadata → the global TierGuard
    // passes the route through.
    expect(
      Reflect.getMetadata(REQUIRES_JOB_KEY, SearchController.prototype.search),
    ).toBeUndefined();

    // No schedule/worker bits pulled in by the search module (cron isolation).
    const searchImports: unknown[] =
      Reflect.getMetadata('imports', SearchModule) ?? [];
    const importsSchedule = searchImports.some(
      (imp) =>
        imp === ScheduleModule ||
        (imp as { module?: unknown })?.module === ScheduleModule,
    );
    expect(importsSchedule).toBe(false);

    // A full round-trip through the composed module serves results.
    const res = await controller.search('axiata');
    // Wire-form check against the contract (ADR-0014): what the SPA receives.
    parseOrThrow(SearchResponse, JSON.parse(JSON.stringify(res)));
    expect(res.items.map((r) => r.stockCode)).toEqual(['6888']);
  });
});

// --- fixtures --------------------------------------------------------------

const envBackup: Record<string, string | undefined> = {};

/** Boot the real SearchModule against the testcontainers URLs (env-backed). */
async function bootModule() {
  const env: Record<'DATABASE_URL' | 'REDIS_URL' | 'SESSION_SECRET', string> = {
    DATABASE_URL: pgContainer.getConnectionUri(),
    REDIS_URL: redisContainer.getConnectionUrl(),
    SESSION_SECRET: 'search-int-spec',
  };
  (Object.keys(env) as (keyof typeof env)[]).forEach((key) => {
    envBackup[key] = process.env[key];
    process.env[key] = env[key];
  });

  return Test.createTestingModule({
    imports: [ConfigModule, RedisModule, SearchModule],
  }).compile();
}

/** Seed the reference universe + band fixtures under one real run. */
async function seedUniverse(): Promise<void> {
  const runs = new IngestionRunService();
  const run = await runs.openRun(
    dataSource.manager,
    'SearchSeedAdapter',
    ProvenanceClass.Real,
  );

  const sectorRepo = dataSource.getRepository(Sector);
  const sectorByName = new Map<string, string>();
  const ensureSector = async (name: string): Promise<string> => {
    const cached = sectorByName.get(name);
    if (cached) return cached;
    const existing = await sectorRepo.findOne({ where: { name } });
    if (existing) {
      sectorByName.set(name, existing.id);
      return existing.id;
    }
    const sector = await sectorRepo.save(
      sectorRepo.create({ name, subsector: null, ingestionRunId: run.id }),
    );
    sectorByName.set(name, sector.id);
    return sector.id;
  };

  const companyRepo = dataSource.getRepository(Company);
  const instrumentRepo = dataSource.getRepository(Instrument);

  const entries: SeedEntry[] = [
    ...REFERENCE_UNIVERSE.map((ref) => ({
      stockCode: ref.stockCode,
      shortName: ref.shortName,
      fullName: ref.fullName,
      board: ref.board,
      sectorName: ref.sectorName,
      aliases: ref.aliases,
    })),
    ...EXTRA_FIXTURES,
  ];

  for (const entry of entries) {
    const sectorId = await ensureSector(entry.sectorName);
    const company = await companyRepo.save(
      companyRepo.create({
        fullName: entry.fullName,
        board: entry.board,
        aliases: [...(entry.aliases ?? [])],
        sectorId,
        ingestionRunId: run.id,
      }),
    );
    await instrumentRepo.save(
      instrumentRepo.create({
        stockCode: entry.stockCode,
        shortName: entry.shortName,
        fullName: entry.fullName,
        companyId: company.id,
        ingestionRunId: run.id,
      }),
    );
  }
}
