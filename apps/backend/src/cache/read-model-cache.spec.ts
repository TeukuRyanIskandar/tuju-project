import type { Redis } from 'ioredis';
import {
  DEFAULT_READ_CACHE_TTL_SECONDS,
  ReadModelCache,
} from './read-model-cache';
import { ReadModelReads } from './read-model-reads';
import type { AppConfig } from '../config/config';

/**
 * ReadModelCache unit tests — a hand-rolled Redis fake. The "after change X,
 * read Y misses" matrix runs against real Redis in
 * `read-model-cache.int-spec.ts`; this pins the read-through mechanics and
 * the SCAN-never-KEYS invalidation.
 */

/** Minimal ioredis surface the cache uses. */
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

function config(readTtlSeconds = DEFAULT_READ_CACHE_TTL_SECONDS): AppConfig {
  return { cache: { readTtlSeconds } } as AppConfig;
}

const CORE = ReadModelReads.stockCore('1155');

describe('ReadModelCache', () => {
  it('read: a miss loads, caches with the configured EX TTL, and returns the value', async () => {
    const redis = fakeRedis();
    const cache = new ReadModelCache(redis, config(90));
    const payload = { stockCode: '1155', ratios: { pe: null, dy: 4.25 } };

    expect(await cache.read(CORE, async () => payload)).toEqual(payload);
    expect(redis.set).toHaveBeenCalledWith(CORE.key, JSON.stringify(payload), 'EX', 90);
  });

  it('read: a hit is served without running the loader', async () => {
    const cache = new ReadModelCache(fakeRedis(), config());
    await cache.read(CORE, async () => ({ value: 7 }));
    const loader = jest.fn(async () => ({ value: 42 }));

    expect(await cache.read(CORE, loader)).toEqual({ value: 7 });
    expect(loader).not.toHaveBeenCalled();
  });

  it('read: a throwing loader (a 404) propagates and caches nothing', async () => {
    const redis = fakeRedis();
    const cache = new ReadModelCache(redis, config());
    await expect(
      cache.read(CORE, async () => {
        throw new Error('not found');
      }),
    ).rejects.toThrow('not found');
    expect(redis.store.size).toBe(0);
  });

  it('read: an undefined loader result is returned but never cached', async () => {
    const cache = new ReadModelCache(fakeRedis(), config());
    expect(await cache.read(CORE, async () => undefined)).toBeUndefined();
    expect(await cache.peek(CORE)).toBeNull();
  });

  it('peek: the cached copy or null, never loading', async () => {
    const cache = new ReadModelCache(fakeRedis(), config());
    expect(await cache.peek(ReadModelReads.indices())).toBeNull();
    await cache.read(ReadModelReads.indices(), async () => [{ id: 'klci' }]);
    expect(await cache.peek(ReadModelReads.indices())).toEqual([{ id: 'klci' }]);
  });

  it('changed: sweeps every key under the change’s prefixes via SCAN, never KEYS', async () => {
    const redis = fakeRedis();
    const cache = new ReadModelCache(redis, config());
    for (let i = 0; i < 5; i++) {
      await cache.read(ReadModelReads.search(`q${i}`, 20), async () => i);
      await cache.read(ReadModelReads.stockCore(`s${i}`), async () => i);
    }
    await cache.read(ReadModelReads.latestMarketBrief(), async () => 'brief');
    redis.store.set('session:abc', 'not-mine');
    redis.store.set('intraday:movers:gainers', 'class-3');

    await cache.changed({ kind: 'eodIngested' });

    expect(redis.keys).not.toHaveBeenCalled();
    expect([...redis.store.keys()].sort()).toEqual([
      'cache:brief:latest',
      'intraday:movers:gainers',
      'session:abc',
    ]);
  });

  it('changed: an invalidation failure throws (the writer fails loudly)', async () => {
    const redis = fakeRedis();
    (redis.scan as jest.Mock).mockRejectedValueOnce(new Error('redis down'));
    const cache = new ReadModelCache(redis, config());
    await expect(cache.changed({ kind: 'purged' })).rejects.toThrow('redis down');
  });
});
