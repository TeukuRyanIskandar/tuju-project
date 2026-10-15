import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { READ_CACHE_KEY_PREFIX } from './cache-keys';
import type { ReadModelRead } from './read-model-reads';
import {
  invalidationPrefixesFor,
  type ReadModelChange,
} from './read-model-changes';

/**
 * Default class-2 TTL (one EOD-derived horizon). Overridable via
 * `READ_CACHE_TTL_SECONDS` (read into `APP_CONFIG.cache.readTtlSeconds`).
 */
export const DEFAULT_READ_CACHE_TTL_SECONDS = 24 * 60 * 60;

/** SCAN page size for prefix invalidation (never `KEYS`). */
const SCAN_COUNT = 100;

/**
 * The read-model cache: ADR-0004's class-2 read-through cache over the shared
 * Redis (`cache:` prefix; same connection as BullMQ + sessions, separated by
 * key prefix). Pure derived-data cache — a flush is a performance event,
 * never a correctness event.
 *
 * Interface:
 * - Readers name a domain read (`ReadModelReads.*`) and pass a loader to
 *   {@link read}. Loaders must resolve to a defined JSON-serialisable value;
 *   a thrown error (e.g. a 404) propagates and is never cached.
 * - Writers announce what changed ({@link changed}) AFTER their write
 *   commits; the module's event → prefixes table decides what goes stale.
 *   Invalidation errors throw (an ingest/purge fails loudly; a job family's
 *   throw is logged by the JobBus).
 *
 * Class-3 intraday keys (`intraday:*`) are not read-model cache entries and
 * are never touched here.
 */
@Injectable()
export class ReadModelCache {
  private readonly logger = new Logger(ReadModelCache.name);
  private readonly ttlSeconds: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.ttlSeconds = config.cache.readTtlSeconds;
  }

  /** Read-through: serve the cached copy, or load, cache (class-2 TTL) and return. */
  async read<T>(read: ReadModelRead, loader: () => Promise<T>): Promise<T> {
    const hit = await this.peek<T>(read);
    if (hit !== null) return hit;
    const value = await loader();
    if (value !== undefined) {
      await this.redis.set(read.key, JSON.stringify(value), 'EX', this.ttlSeconds);
    }
    return value;
  }

  /** The cached copy only, or `null` on miss — never loads. */
  async peek<T>(read: ReadModelRead): Promise<T | null> {
    const raw = await this.redis.get(read.key);
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  /** A write committed: drop every cached read the change makes stale. */
  async changed(change: ReadModelChange): Promise<void> {
    // Sequential so one failing sweep throws before the next (fail loud).
    for (const prefix of invalidationPrefixesFor(change)) {
      const deleted = await this.invalidatePrefix(prefix);
      if (deleted > 0) {
        this.logger.log({
          msg: 'read-cache.invalidated',
          change: change.kind,
          prefix,
          deleted,
        });
      }
    }
  }

  /**
   * Delete every key under a prefix. SCAN pages to collect the full match set
   * FIRST, then one DEL — never `KEYS` (blocking on a shared Redis) and never
   * delete per page (shifts the cursor, can skip keys). SCAN may repeat keys,
   * so the set is deduped.
   */
  private async invalidatePrefix(prefix: string): Promise<number> {
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
    return keys.size > 0 ? this.redis.del(...keys) : 0;
  }
}
