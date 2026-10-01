import type { Redis } from 'ioredis';
import {
  DEFAULT_READ_CACHE_TTL_SECONDS,
  ReadCacheService,
} from './read-cache.service';
import { SEARCH_CACHE_PREFIX, STOCKS_CACHE_PREFIX } from './cache-keys';

/**
 * Class-2 read-through cache unit tests (spec 02 ticket 01) — a mocked Redis
 * client; the invalidation-wiring behaviour (nightly ingest + purge calling
 * `invalidatePrefix` after commit) is pinned end-to-end against real
 * testcontainers in `src/ingestion/ingestion.int.spec.ts`.
 */

/** Minimal ioredis surface the service uses — a hand-rolled fake. */
function fakeRedis() {
  const store = new Map<string, string>();
  const redis = {
    store,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (...keys: string[]) => {
      let n = 0;
      for (const k of keys) if (store.delete(k)) n++;
      return n;
    }),
    // SCAN pages of 2 keys so the page loop is actually exercised.
    scan: jest.fn(async (cursor: string, _MATCH: string, pattern: string) => {
      const stem = pattern.replace(/\*$/, '');
      const matching = [...store.keys()].sort().filter((k) => k.startsWith(stem));
      const from = Number(cursor);
      const page = matching.slice(from, from + 2);
      const next = from + 2 >= matching.length ? '0' : String(from + 2);
      return [next, page] as [string, string[]];
    }),
    keys: jest.fn(),
  };
  return redis as unknown as Redis & { store: Map<string, string> };
}

describe('ReadCacheService (class-2 read-through cache)', () => {
  it('round-trips JSON values with null on miss', async () => {
    const redis = fakeRedis();
    const cache = new ReadCacheService(redis);

    expect(await cache.get('cache:x')).toBeNull();

    const payload = {
      stockCode: '1155',
      ratios: { pe: null, dy: 4.25 },
      sectors: ['Financial Services'],
    };
    await cache.set('cache:stocks:1155:core', payload);
    expect(await cache.get('cache:stocks:1155:core')).toEqual(payload);
    expect(await cache.get<{ ratios: { pe: null } }>('cache:stocks:1155:core').then((v) => v!.ratios.pe)).toBeNull();
  });

  it('writes with the EX TTL form and the class-2 default horizon', async () => {
    const redis = fakeRedis();
    const cache = new ReadCacheService(redis);

    await cache.set('cache:k', { a: 1 });
    expect(redis.set).toHaveBeenCalledWith(
      'cache:k',
      JSON.stringify({ a: 1 }),
      'EX',
      DEFAULT_READ_CACHE_TTL_SECONDS,
    );

    await cache.set('cache:k', { a: 2 }, 60);
    expect(redis.set).toHaveBeenLastCalledWith('cache:k', JSON.stringify({ a: 2 }), 'EX', 60);
  });

  it('honours a positive READ_CACHE_TTL_SECONDS override and ignores garbage', () => {
    const cache = new ReadCacheService(fakeRedis());
    try {
      process.env.READ_CACHE_TTL_SECONDS = '90';
      expect(cache.defaultTtlSeconds).toBe(90);
      process.env.READ_CACHE_TTL_SECONDS = 'not-a-number';
      expect(cache.defaultTtlSeconds).toBe(DEFAULT_READ_CACHE_TTL_SECONDS);
      process.env.READ_CACHE_TTL_SECONDS = '-5';
      expect(cache.defaultTtlSeconds).toBe(DEFAULT_READ_CACHE_TTL_SECONDS);
    } finally {
      delete process.env.READ_CACHE_TTL_SECONDS;
    }
  });

  it('remember serves hits without loading and caches misses', async () => {
    const redis = fakeRedis();
    const cache = new ReadCacheService(redis);
    const loader = jest.fn(async () => ({ value: 42 }));

    await cache.set('cache:hit', { value: 7 });
    await cache.remember('cache:hit', loader);
    expect(loader).not.toHaveBeenCalled();
    expect(await cache.remember<{ value: number }>('cache:hit', loader)).toEqual({ value: 7 });

    const miss = await cache.remember('cache:miss', loader);
    expect(miss).toEqual({ value: 42 });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(await cache.get('cache:miss')).toEqual({ value: 42 });
  });

  it('remember returns undefined loader results without caching them', async () => {
    const cache = new ReadCacheService(fakeRedis());
    const loader = jest.fn(async () => undefined as unknown as void);

    const out = await cache.remember('cache:nothing', loader);
    expect(out).toBeUndefined();
    expect(await cache.get('cache:nothing')).toBeNull();
  });

  it('del drops exactly one key', async () => {
    const redis = fakeRedis();
    const cache = new ReadCacheService(redis);
    await cache.set('cache:a', 1);
    await cache.set('cache:b', 2);

    await cache.del('cache:a');
    expect(await cache.get('cache:a')).toBeNull();
    expect(await cache.get('cache:b')).toEqual(2);
  });

  it('invalidatePrefix deletes every key under the prefix via SCAN, never KEYS', async () => {
    const redis = fakeRedis();
    const cache = new ReadCacheService(redis);
    for (let i = 0; i < 5; i++) {
      await cache.set(`${SEARCH_CACHE_PREFIX}q${i}`, { i });
      await cache.set(`${STOCKS_CACHE_PREFIX}s${i}:core`, { i });
    }
    await cache.set('cache:unrelated', 'keep-me');
    await cache.set('session:abc', 'not-mine');

    const deleted = await cache.invalidatePrefix(SEARCH_CACHE_PREFIX);

    expect(deleted).toBe(5);
    expect((redis.scan as jest.Mock).mock.calls.every((call) => call[2] === `${SEARCH_CACHE_PREFIX}*`)).toBe(true);
    expect(redis.keys).not.toHaveBeenCalled();
    for (let i = 0; i < 5; i++) {
      expect(await cache.get(`${SEARCH_CACHE_PREFIX}q${i}`)).toBeNull();
      expect(await cache.get(`${STOCKS_CACHE_PREFIX}s${i}:core`)).not.toBeNull();
    }
    expect(await cache.get('cache:unrelated')).toBe('keep-me');
  });

  it('refuses to invalidate a prefix outside cache: (BullMQ/session keyspace)', async () => {
    const cache = new ReadCacheService(fakeRedis());
    await expect(cache.invalidatePrefix('session:')).rejects.toThrow(/outside the read-cache prefix/);
    await expect(cache.invalidatePrefix('bull:')).rejects.toThrow(/outside the read-cache prefix/);
  });
});
