/**
 * Synthetic delayed-intraday replay (spec 01 cadences; ticket 04, ADR-0004;
 * extended spec 05 ticket 03 — live index levels + movers precompute).
 *
 * Every 5 minutes during market hours the worker replays a synthetic intraday
 * tick per instrument into **Redis only** — never Postgres. The ephemeral-intraday
 * posture (ADR-0004: the live layer is Redis-only by legal necessity in production;
 * here it is synthetic but the boundary is identical) means this path holds NO
 * TypeORM repository and opens NO transaction. A downstream reader takes the last
 * tick from Redis; nothing about intraday is ever a system-of-record row.
 *
 * Spec 05 ticket 03 extends one tick with the live market-overview values, all
 * class 3 (Redis-only, same `intraday:` namespace + short-TTL posture as the
 * per-instrument ticks):
 *  - a live cap-weighted level per index (headline + every sector index),
 *    recomputed from the current intraday prices via the SAME pure
 *    cap-weighted maths the nightly series uses (`computeLiveIndexLevels`);
 *  - the three precomputed movers boards over the whole analysed universe
 *    (gainers/losers by %change, actives by volume — no floor, spec option A),
 *    so the read endpoint is a pure slice of a sorted board.
 *
 * Keys are namespaced under `intraday:` with a short TTL so a restart drops them
 * cleanly (rebuilt on the next tick), exactly like the production live layer.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { generate } from '../data/synthetic';
import { MarketIndexKind } from '../data/entities/enums';
import {
  computeLiveIndexLevels,
  type ConstituentInput,
} from '../data/adapters/index-computation';
import { pctChange } from '../stocks/serialisation';
import {
  REFERENCE_UNIVERSE,
  SYNTHETIC_BASE_SEED,
  instrumentSeed,
} from './reference-universe';
import {
  MOVERS_BOARD_TYPES,
  buildMoversBoards,
  intradayPrice,
  intradayWobblePhase,
  mytMinuteOfDay,
  type MoverEntry,
  type MoverSnapshot,
  type MoversBoardType,
} from './intraday-model';

/** Redis key prefix for the disposable intraday layer. */
export const INTRADAY_KEY_PREFIX = 'intraday:last';

/** Redis key prefix for the precomputed movers boards (spec 05, ticket 03). */
export const INTRADAY_MOVERS_KEY_PREFIX = 'intraday:movers';

/** Redis key prefix for the live index levels (spec 05, ticket 03). */
export const INTRADAY_INDEX_KEY_PREFIX = 'intraday:index:live';

/** TTL (seconds) on an intraday tick — short so it is never a store of record. */
export const INTRADAY_TTL_SECONDS = 15 * 60;

/** One replayed intraday tick (what a reader takes from Redis). */
export interface IntradayTick {
  stockCode: string;
  price: string;
  at: string;
}

/** One live index level held in Redis (class 3 — the market-overview read payload). */
export interface LiveIndexLevelTick {
  kind: MarketIndexKind;
  /** The Bursa Sector name the index scopes to; null on the headline index. */
  sectorName: string | null;
  name: string;
  /** Live cap-weighted level, numeric(18,6) scale string (the `IndexLevel` scale). */
  level: string;
  /** Latest EOD level of the same series — the %change basis. */
  prevLevel: string;
  /** (level − prevLevel) / prevLevel × 100; null when prevLevel = 0 (undefined). */
  pctChange: number | null;
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

  /** Redis key for one precomputed movers board. */
  static moversKey(type: MoversBoardType): string {
    return `${INTRADAY_MOVERS_KEY_PREFIX}:${type}`;
  }

  /**
   * Redis key for one index's live level — derivable from what the read
   * surface joins on (the `MarketIndex` row's kind + its Sector's name; the
   * headline index carries no sector segment).
   */
  static indexKey(kind: MarketIndexKind, sectorName: string | null): string {
    return sectorName === null
      ? `${INTRADAY_INDEX_KEY_PREFIX}:${kind}`
      : `${INTRADAY_INDEX_KEY_PREFIX}:${kind}:${sectorName}`;
  }

  /**
   * Replay one synthetic intraday tick per instrument into Redis, then extend
   * the tick with the live market-overview values (spec 05, ticket 03): a live
   * cap-weighted level per index and the three precomputed movers boards. Touches
   * Redis ONLY — no Postgres. `now` is injectable for deterministic tests; the
   * tick price is derived from the seeded generator's latest close plus a
   * bounded, time-derived wobble (per-instrument phase, so the movers boards
   * order) so successive ticks move without any RNG state.
   */
  async replayTick(now: Date = new Date()): Promise<IntradayTick[]> {
    const minutes = mytMinuteOfDay(now);
    const ticks: IntradayTick[] = [];
    const snapshots: MoverSnapshot[] = [];
    const constituents: ConstituentInput[] = [];
    const livePrices = new Map<string, number>();

    for (const company of REFERENCE_UNIVERSE) {
      const seed = instrumentSeed(SYNTHETIC_BASE_SEED, company.stockCode);
      const dataset = generate(seed);
      const lastBar = dataset.priceBars[dataset.priceBars.length - 1]!;
      const lastClose = Number(lastBar.close);
      const price = intradayPrice(
        lastClose,
        minutes,
        intradayWobblePhase(company.stockCode),
      );

      const tick: IntradayTick = {
        stockCode: company.stockCode,
        price: price.toFixed(6),
        at: now.toISOString(),
      };
      await this.redis.set(
        IntradayReplayService.key(company.stockCode),
        JSON.stringify(tick),
        'EX',
        INTRADAY_TTL_SECONDS,
      );
      ticks.push(tick);

      snapshots.push({
        stockCode: company.stockCode,
        shortName: company.shortName,
        livePrice: price,
        prevClose: lastClose,
        dailyVolume: Number(lastBar.volume),
      });
      constituents.push({
        stockCode: company.stockCode,
        sectorName: company.sectorName,
        sharesOutstanding: Number(dataset.snapshot.sharesOutstanding),
        bars: dataset.priceBars.map((b) => ({
          tradeDate: b.tradeDate,
          close: Number(b.close),
        })),
      });
      livePrices.set(company.stockCode, price);
    }

    // Movers precompute (class 3): the three boards over the whole analysed
    // universe, written per board so the endpoint is a pure read.
    const boards = buildMoversBoards(snapshots, minutes);
    for (const type of MOVERS_BOARD_TYPES) {
      await this.redis.set(
        IntradayReplayService.moversKey(type),
        JSON.stringify(boards[type]),
        'EX',
        INTRADAY_TTL_SECONDS,
      );
    }

    // Live index levels (class 3): recompute the live cap-weighted level for
    // the headline index and every sector index from the current intraday
    // prices — the same pure maths as the nightly series, never persisted.
    const liveLevels = computeLiveIndexLevels(constituents, livePrices);
    for (const l of liveLevels) {
      const payload: LiveIndexLevelTick = {
        kind: l.kind,
        sectorName: l.sectorName,
        name: l.name,
        level: l.level.toFixed(6),
        prevLevel: l.prevLevel.toFixed(6),
        pctChange: pctChange(l.level, l.prevLevel),
        at: now.toISOString(),
      };
      await this.redis.set(
        IntradayReplayService.indexKey(l.kind, l.sectorName),
        JSON.stringify(payload),
        'EX',
        INTRADAY_TTL_SECONDS,
      );
    }

    this.logger.debug(
      `intraday replay wrote ${ticks.length} ticks, ${MOVERS_BOARD_TYPES.length} movers boards, ${liveLevels.length} live index levels to Redis`,
    );
    return ticks;
  }

  /** Read the last intraday tick for an instrument from Redis (reader helper). */
  async lastTick(stockCode: string): Promise<IntradayTick | null> {
    const raw = await this.redis.get(IntradayReplayService.key(stockCode));
    return raw ? (JSON.parse(raw) as IntradayTick) : null;
  }

  /** Read one precomputed movers board from Redis (reader helper). */
  async moversBoard(type: MoversBoardType): Promise<MoverEntry[] | null> {
    const raw = await this.redis.get(IntradayReplayService.moversKey(type));
    return raw ? (JSON.parse(raw) as MoverEntry[]) : null;
  }

  /** Read one index's live level from Redis (reader helper). */
  async liveIndexLevel(
    kind: MarketIndexKind,
    sectorName: string | null,
  ): Promise<LiveIndexLevelTick | null> {
    const raw = await this.redis.get(
      IntradayReplayService.indexKey(kind, sectorName),
    );
    return raw ? (JSON.parse(raw) as LiveIndexLevelTick) : null;
  }
}
