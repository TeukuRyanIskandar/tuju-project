/**
 * "After change X, read Y misses" — the read-model cache's invalidation
 * contract, written ONCE against a real Redis (testcontainers; ADR-0011).
 *
 * Every case warms one representative read of every family, announces one
 * change, and asserts exactly which reads miss (their loader runs again) and
 * which still hit. Class-3 intraday keys and non-cache keys are never touched.
 */

import IORedis, { type Redis } from 'ioredis';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import type { AppConfig } from '../config/config';
import { ReadModelCache } from './read-model-cache';
import { ReadModelReads, type ReadModelRead } from './read-model-reads';
import type { ReadModelChange } from './read-model-changes';

jest.setTimeout(120_000);

const page = { offset: 0, limit: 20 };
const feedQuery = { from: null, to: null, offset: 0, limit: 25 };

/** One representative read per cached family (plus "other stock" controls). */
const READS = {
  search: ReadModelReads.search('maybank', 20),
  stockCore: ReadModelReads.stockCore('1155'),
  stockAnnouncements: ReadModelReads.stockAnnouncements('1155', [], page),
  otherStockAnnouncements: ReadModelReads.stockAnnouncements('5225', [], page),
  stockCorporateActions: ReadModelReads.stockCorporateActions('1155', [], page),
  stockTechnical: ReadModelReads.stockAnalysis('1155', 'technical'),
  stockFundamental: ReadModelReads.stockAnalysis('1155', 'fundamental'),
  marketAnnouncements: ReadModelReads.marketAnnouncements([], feedQuery),
  dealings: ReadModelReads.dealings(['SHAREHOLDING_CHANGE'], feedQuery),
  resultsCalendar: ReadModelReads.resultsCalendar({ from: null, to: null }),
  news: ReadModelReads.news(page),
  screenerFields: ReadModelReads.screenerFields(),
  moversEod: ReadModelReads.moversEod('gainers'),
  indices: ReadModelReads.indices(),
  brief: ReadModelReads.latestMarketBrief(),
  prospectus: ReadModelReads.prospectusAtAGlance('p-1'),
  otherProspectus: ReadModelReads.prospectusAtAGlance('p-2'),
} satisfies Record<string, ReadModelRead>;

type ReadName = keyof typeof READS;
const ALL = Object.keys(READS) as ReadName[];

const BULK: ReadName[] = ALL.filter(
  (n) => !['brief', 'prospectus', 'otherProspectus'].includes(n),
);

const CASES: Array<{ change: ReadModelChange; misses: ReadName[] }> = [
  { change: { kind: 'eodIngested' }, misses: BULK },
  { change: { kind: 'purged' }, misses: BULK },
  {
    change: { kind: 'announcementSummarised', announcementId: 'a-1', stockCodes: ['1155'] },
    misses: ['stockAnnouncements', 'marketAnnouncements', 'dealings'],
  },
  {
    change: { kind: 'stockAnalysisChanged', stockCode: '1155', analysis: 'technical' },
    misses: ['stockTechnical'],
  },
  { change: { kind: 'marketBriefLanded' }, misses: ['brief'] },
  { change: { kind: 'prospectusAnalysed', prospectusId: 'p-1' }, misses: ['prospectus'] },
];

describe('ReadModelCache invalidation (integration — real Redis)', () => {
  let container: StartedRedisContainer;
  let redis: Redis;
  let cache: ReadModelCache;

  beforeAll(async () => {
    container = await new RedisContainer('redis:7.4-alpine').start();
    redis = new IORedis(container.getConnectionUrl(), { maxRetriesPerRequest: null });
    cache = new ReadModelCache(redis, { cache: { readTtlSeconds: 600 } } as AppConfig);
  });

  afterAll(async () => {
    await redis?.quit();
    await container?.stop();
  });

  beforeEach(async () => {
    await redis.flushall();
  });

  /** Read every named read; return the names whose loader ran (= missed). */
  async function readAll(): Promise<ReadName[]> {
    const missed: ReadName[] = [];
    for (const name of ALL) {
      await cache.read(READS[name], async () => {
        missed.push(name);
        return { name };
      });
    }
    return missed;
  }

  it('reads hit once warmed, with the configured TTL', async () => {
    expect(await readAll()).toEqual(ALL);
    expect(await readAll()).toEqual([]);
    const ttl = await redis.ttl(READS.stockCore.key);
    expect(ttl).toBeGreaterThan(590);
    expect(ttl).toBeLessThanOrEqual(600);
  });

  it.each(CASES)('after $change.kind, exactly the expected reads miss', async ({ change, misses }) => {
    await readAll();
    await redis.set('intraday:movers:gainers', '[]', 'EX', 60);
    await redis.set('sess:abc', 'session');

    await cache.changed(change);

    expect(await readAll()).toEqual(ALL.filter((n) => misses.includes(n)));
    expect(await redis.get('intraday:movers:gainers')).toBe('[]');
    expect(await redis.get('sess:abc')).toBe('session');
  });

  it('invalidation pages through SCAN on a keyspace larger than one page', async () => {
    for (let i = 0; i < 350; i++) {
      await cache.read(ReadModelReads.search(`q${i}`, 20), async () => i);
    }
    await cache.changed({ kind: 'eodIngested' });
    expect(await redis.keys('cache:search:*')).toEqual([]);
  });
});
