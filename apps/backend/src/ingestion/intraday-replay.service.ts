/**
 * Synthetic delayed-intraday replay (spec 01 cadences; ticket 04, ADR-0004).
 *
 * Every 5 minutes during market hours the worker replays a synthetic intraday tick
 * per instrument into **Redis only** — never Postgres. The ephemeral-intraday
 * posture (ADR-0004: the live layer is Redis-only by legal necessity in production;
 * here it is synthetic but the boundary is identical) means this path holds NO
 * TypeORM repository and opens NO transaction. A downstream reader takes the last
 * tick from Redis; nothing about intraday is ever a system-of-record row.
 *
 * Keys are namespaced under `intraday:` with a short TTL so a restart drops them
 * cleanly (rebuilt on the next tick), exactly like the production live layer.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { generate } from '../data/synthetic';
import {
  REFERENCE_UNIVERSE,
  SYNTHETIC_BASE_SEED,
  instrumentSeed,
} from './reference-universe';

/** Redis key prefix for the disposable intraday layer. */
export const INTRADAY_KEY_PREFIX = 'intraday:last';

/** TTL (seconds) on an intraday tick — short so it is never a store of record. */
export const INTRADAY_TTL_SECONDS = 15 * 60;

/** One replayed intraday tick (what a reader takes from Redis). */
export interface IntradayTick {
  stockCode: string;
  price: string;
  at: string;
}

@Injectable()
export class IntradayReplayService {
  private readonly logger = new Logger(IntradayReplayService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Redis key for one instrument's latest intraday tick. */
  static key(stockCode: string): string {
    return `${INTRADAY_KEY_PREFIX}:${stockCode}`;
  }

  /**
   * Replay one synthetic intraday tick per instrument into Redis. Touches Redis
   * ONLY — no Postgres. `now` is injectable for deterministic tests; the tick
   * price is derived from the seeded generator's latest close plus a bounded,
   * time-derived wobble so successive ticks move without any RNG state.
   */
  async replayTick(now: Date = new Date()): Promise<IntradayTick[]> {
    const ticks: IntradayTick[] = [];
    for (const company of REFERENCE_UNIVERSE) {
      const seed = instrumentSeed(SYNTHETIC_BASE_SEED, company.stockCode);
      const dataset = generate(seed);
      const lastClose = Number(
        dataset.priceBars[dataset.priceBars.length - 1].close,
      );
      // Deterministic intraday wobble from the minute-of-day (±0.5%).
      const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
      const wobble = Math.sin(minutes / 30) * 0.005;
      const price = (lastClose * (1 + wobble)).toFixed(6);

      const tick: IntradayTick = {
        stockCode: company.stockCode,
        price,
        at: now.toISOString(),
      };
      await this.redis.set(
        IntradayReplayService.key(company.stockCode),
        JSON.stringify(tick),
        'EX',
        INTRADAY_TTL_SECONDS,
      );
      ticks.push(tick);
    }
    this.logger.debug(`intraday replay wrote ${ticks.length} ticks to Redis`);
    return ticks;
  }

  /** Read the last intraday tick for an instrument from Redis (reader helper). */
  async lastTick(stockCode: string): Promise<IntradayTick | null> {
    const raw = await this.redis.get(IntradayReplayService.key(stockCode));
    return raw ? (JSON.parse(raw) as IntradayTick) : null;
  }
}
