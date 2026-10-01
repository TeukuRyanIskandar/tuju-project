import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { READ_CACHE_KEY_PREFIX } from './cache-keys';

/**
 * Default class-2 TTL (one EOD-derived horizon). Overridable via
 * `READ_CACHE_TTL_SECONDS` for local experimentation — never required.
 */
export const DEFAULT_READ_CACHE_TTL_SECONDS = 24 * 60 * 60;

/** SCAN page size for prefix invalidation (never `KEYS` — O(1) vs O(N) keyspace). */
const SCAN_COUNT = 100;

/**
 * ADR-0004 class-2 read-through cache over the shared Redis instance
 * (`cache:` prefix; same connection as BullMQ + sessions, separated by key
 * prefix). Pure derived-data cache: everything here is cold-rebuildable from
 * Postgres, so a flush is a performance event, never a correctness event.
 *
 * `remember` loaders must resolve to JSON-serialisable, defined values (an
 * endpoint that 404s should not cache — throw `NotFoundException` through
 * instead of caching a null).
 */
@Injectable()
export class ReadCacheService {
  private readonly logger = new Logger(ReadCacheService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Resolved default TTL (env override when set to a positive integer). */
  get defaultTtlSeconds(): number {
    const parsed = Number(process.env.READ_CACHE_TTL_SECONDS);
    return Number.isFinite(parsed) && parsed > 0
      ? Math.floor(parsed)
      : DEFAULT_READ_CACHE_TTL_SECONDS;
  }

  /** Read a cached value; `null` on miss (or expiry). */
  async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  }

  /** Write a value with a TTL in seconds (default: the class-2 horizon). */
  async set(
    key: string,
    value: unknown,
    ttlSeconds: number = this.defaultTtlSeconds,
  ): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  /** Drop one key (single-page invalidation). */
  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  /**
   * Read-through: serve the cached copy or run the loader, cache, and return
   * it. The loader must resolve to a defined JSON-serialisable value; an
   * `undefined` result is returned but never cached (nothing to rebuild from).
   */
  async remember<T>(
    key: string,
    loader: () => Promise<T>,
    ttlSeconds: number = this.defaultTtlSeconds,
  ): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== null) return hit;
    const value = await loader();
    if (value !== undefined) await this.set(key, value, ttlSeconds);
    return value;
  }

  /**
   * Delete every key under a prefix (e.g. `cache:stocks:`). SCAN pages to
   * collect the full match set FIRST, then one DEL — never `KEYS` (a blocking
   * full-keyspace scan on a shared Redis is exactly the footgun SCAN exists
   * for) and never delete per page (deleting mid-scan shifts the cursor and
   * can skip keys). SCAN may repeat keys across pages, so the set is deduped.
   * Returns the number deleted.
   */
  async invalidatePrefix(prefix: string): Promise<number> {
    if (!prefix.startsWith(READ_CACHE_KEY_PREFIX)) {
      throw new Error(
        `Refusing to invalidate outside the read-cache prefix: ${prefix}`,
      );
    }
    const keys = new Set<string>();
    let cursor = '0';
    do {
      const [next, page] = await this.redis.scan(
        cursor,
        'MATCH',
        `${prefix}*`,
        'COUNT',
        SCAN_COUNT,
      );
      cursor = next;
      for (const key of page) keys.add(key);
    } while (cursor !== '0');

    let deleted = 0;
    if (keys.size > 0) deleted = await this.redis.del(...keys);
    if (deleted > 0) {
      this.logger.log({ msg: 'read-cache.invalidated', prefix, deleted });
    }
    return deleted;
  }
}
