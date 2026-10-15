import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { READ_CACHE_KEY_PREFIX } from './cache-keys';
import type { ReadModelRead } from './read-model-reads';
import { invalidationsFor, type ReadModelChange } from './read-model-changes';

/**
 * Default class-2 TTL (one EOD-derived horizon). Overridable via
 * `READ_CACHE_TTL_SECONDS` (read into `APP_CONFIG.cache.readTtlSeconds`).
 */
export const DEFAULT_READ_CACHE_TTL_SECONDS = 24 * 60 * 60;

/** SCAN page size for prefix invalidation (never `KEYS`). */
const SCAN_COUNT = 100;

/**
 * Bumped by every {@link ReadModelCache.changed} BEFORE it deletes anything.
 * A read-through fill is written only if the generation is unchanged since
 * the read began, so a loader that read a row before a write committed can
 * never re-cache that stale row after the writer's invalidation.
 */
export const READ_CACHE_GENERATION_KEY = `${READ_CACHE_KEY_PREFIX}generation`;

/** KEYS[1] generation, KEYS[2] read key; ARGV generation-at-start, value, TTL. */
const SET_IF_GENERATION = `
if (redis.call('GET', KEYS[1]) or '') == ARGV[1] then
  return redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
end
return nil`;

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

  /**
   * Read-through: serve the cached copy, or load, cache (class-2 TTL) and
   * return. The fill is skipped when any change was announced while the
   * loader ran (see {@link READ_CACHE_GENERATION_KEY}); the next read loads.
   */
  async read<T>(read: ReadModelRead, loader: () => Promise<T>): Promise<T> {
    const [raw, generation] = await this.redis.mget(
      read.key,
      READ_CACHE_GENERATION_KEY,
    );
    if (raw !== null) return JSON.parse(raw) as T;
    const value = await loader();
    if (value !== undefined) {
      await this.redis.eval(
        SET_IF_GENERATION,
        2,
        READ_CACHE_GENERATION_KEY,
        read.key,
        generation ?? '',
        JSON.stringify(value),
        this.ttlSeconds,
      );
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
    const { keys, prefixes } = invalidationsFor(change);
    // Generation first, so an in-flight fill that started before this change
    // either lands before the deletes below or is refused.
    await this.redis.incr(READ_CACHE_GENERATION_KEY);
    const stale = new Set(keys);
    for (const key of await this.keysUnder(prefixes)) stale.add(key);
    for (const key of stale) this.assertReadCacheKey(key);
    const deleted = stale.size > 0 ? await this.redis.del(...stale) : 0;
    if (deleted > 0) {
      this.logger.log({
        msg: 'read-cache.invalidated',
        change: change.kind,
        prefixes,
        keys,
        deleted,
      });
    }
  }

  /**
   * Every key under any of the prefixes, in ONE SCAN pass (SCAN walks the
   * whole keyspace whatever the MATCH, so one pass per prefix would multiply
   * that cost). The pass MATCHes the prefixes' common stem and filters
   * client-side. All pages are collected before any DEL — never `KEYS`
   * (blocking on a shared Redis) and never delete per page. SCAN may repeat
   * keys; the caller dedupes.
   */
  private async keysUnder(prefixes: readonly string[]): Promise<string[]> {
    if (prefixes.length === 0) return [];
    for (const prefix of prefixes) this.assertReadCacheKey(prefix);
    const stem = commonPrefix(prefixes);
    const found: string[] = [];
    let cursor = '0';
    do {
      const [next, page] = await this.redis.scan(
        cursor,
        'MATCH',
        `${stem}*`,
        'COUNT',
        SCAN_COUNT,
      );
      cursor = next;
      for (const key of page) {
        if (prefixes.some((p) => key.startsWith(p))) found.push(key);
      }
    } while (cursor !== '0');
    return found;
  }

  private assertReadCacheKey(keyOrPrefix: string): void {
    if (
      !keyOrPrefix.startsWith(READ_CACHE_KEY_PREFIX) ||
      keyOrPrefix === READ_CACHE_GENERATION_KEY
    ) {
      throw new Error(
        `Refusing to invalidate outside the read-cache prefix: ${keyOrPrefix}`,
      );
    }
  }
}

function commonPrefix(values: readonly string[]): string {
  let stem = values[0];
  for (const value of values) {
    while (!value.startsWith(stem)) stem = stem.slice(0, -1);
  }
  return stem;
}
