/**
 * Market-overview service (spec 05, tickets 04 + 05).
 *
 * Four read surfaces:
 *  1. `GET /market/movers` — gainers/losers/actives panel (ticket 04)
 *  2. `GET /market/indices` — headline + sector index panel (ticket 05)
 *  3. `GET /market/indices/:id/series` — chartable IndexLevel history (ticket 05)
 *  4. `GET /market/sectors` — sector-performance board (ticket 05)
 *
 * The ADR-0004 cache-class split:
 *  - **During market hours:** a pure Redis read (class 3) — the intraday
 *    replay writes precomputed boards and live index levels into Redis; the
 *    endpoints slice / read them directly. Postgres is NEVER touched, even on
 *    a cold cache (see `loadLiveIndices` below) — unconditional, like movers.
 *  - **Outside market hours:** an EOD fallback built from the latest stored
 *    rows in Postgres, then cached via `ReadCacheService` (class 2,
 *    `cache:market:` prefix) so subsequent hits are Redis reads too.
 *
 * "Now" is read through {@link MARKET_CLOCK} (a `() => Date` DI token, default
 * the wall clock) rather than `new Date()` or a static scheduler method — so
 * integration tests override one provider instead of spying on a static
 * method, which cannot intercept calls made inside a DIFFERENT
 * `TestingModule`-booted instance of this service.
 *
 * Provenance follows the spec-02 "illustrative labelling" posture: every
 * data block carries the `ProvenanceClass` from the source row's lineage join
 * (`ingestionRunId → IngestionRun.provenanceClass`). Movers rows take the
 * provenance of the PRICE data (`PriceBar`'s run), not the `Instrument`'s —
 * identity/reference rows are `real`, but the close/volume driving the board
 * is the synthetic EOD series, same split as the stock-page technicals block.
 */

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { ReadCacheService, MARKET_CACHE_PREFIX } from '../cache';
import {
  IntradayReplayService,
  type LiveIndexLevelTick,
} from '../ingestion/intraday-replay.service';
import {
  isMarketHours,
  MOVERS_COMPARATORS,
  type MoverEntry,
} from '../ingestion/intraday-model';
import { IndexLevel } from '../data/entities/index-level.entity';
import { MarketIndex } from '../data/entities/market-index.entity';
import { MarketIndexKind, ProvenanceClass } from '../data/entities/enums';
import { pctChange } from '../stocks/serialisation';
import { isUuid } from '../stocks/filters';
import { resolveMoversParams, type RawMoversParams } from './movers-params';
import { resolveSeriesRange, seriesSinceDate } from './index-params';
import type {
  IndexEntry,
  IndexSeriesResponse,
  IndicesResponse,
  MoverRow,
  MoversResponse,
  SectorEntry,
  SectorsResponse,
} from './market.types';

/** `() => Date` DI token — the service's ONLY source of "now" (see file header). */
export const MARKET_CLOCK = Symbol('MARKET_CLOCK');
export type MarketClock = () => Date;

// ─── Cache keys ───────────────────────────────────────────────────────────────

function moversEodCacheKey(type: string): string {
  // Keyed on type only — the loader caches the WHOLE sorted board; `limit` is
  // a read-time slice, so every limit for one type shares one cache entry.
  return `${MARKET_CACHE_PREFIX}movers:eod:${type}`;
}

function indicesCacheKey(): string {
  return `${MARKET_CACHE_PREFIX}indices`;
}

function seriesCacheKey(id: string, range: string): string {
  return `${MARKET_CACHE_PREFIX}indices:${id}:series:${range}`;
}

@Injectable()
export class MarketService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly readCache: ReadCacheService,
    @Inject(MARKET_CLOCK) private readonly clock: MarketClock,
  ) {}

  // ─── Movers (ticket 04) ──────────────────────────────────────────────────

  /**
   * `GET /market/movers` — the "what's moving today" panel.
   *
   * During market hours: pure Redis read of the precomputed board (class 3)
   * then slice to `limit`. Outside hours: EOD-close fallback computed from the
   * latest stored `PriceBar`s, cached via the class-2 read-through.
   */
  async getMovers(raw: RawMoversParams): Promise<MoversResponse> {
    const { type, limit } = resolveMoversParams(raw);

    if (isMarketHours(this.clock())) {
      // Class 3: Redis only, never Postgres.
      const rows = await this.readMoversFromRedis(type, limit);
      return { type, limit, rows };
    }

    // Class 2: EOD fallback, read-through cache — the WHOLE sorted board is
    // cached once per type; `limit` only slices the already-cached result.
    const board = await this.readCache.remember(moversEodCacheKey(type), () =>
      this.loadEodBoard(type),
    );
    return { type, limit, rows: board.slice(0, limit) };
  }

  /**
   * Read the precomputed board from Redis and slice to `limit`.
   * During market hours ONLY — if the board is absent (first tick hasn't run
   * yet) fall back gracefully to an empty board.
   */
  private async readMoversFromRedis(
    type: 'gainers' | 'losers' | 'actives',
    limit: number,
  ): Promise<MoverRow[]> {
    const raw = await this.redis.get(IntradayReplayService.moversKey(type));
    if (!raw) return [];
    const board = JSON.parse(raw) as MoverEntry[];
    return board.slice(0, limit).map((entry) => ({
      provenance: ProvenanceClass.Synthetic,
      stockCode: entry.stockCode,
      shortName: entry.shortName,
      price: entry.price,
      pctChange: entry.pctChange,
      volume: entry.volume,
    }));
  }

  /**
   * EOD fallback: compute the WHOLE movers board (not yet limited) from the
   * latest stored `PriceBar`s, one SQL round trip. A window query ranks each
   * instrument's bars by `tradeDate` DESC; `rn = 1` is the latest bar (price +
   * volume), `LEAD(close)` over the same window is the next-latest close (the
   * %change basis) — so there is no "load every bar, group in JS" scan over
   * the whole universe's history.
   *
   * Provenance is read from the LATEST BAR's own `ingestionRun` (the price
   * data's lineage — `synthetic` for the demo backfill), not the
   * `Instrument`'s (`real`, reference data): the board shows illustrative
   * PRICES, and the stock-page precedent (`StocksService`) makes the same
   * split for its technicals block.
   */
  private async loadEodBoard(type: 'gainers' | 'losers' | 'actives'): Promise<MoverRow[]> {
    const rows: Array<{
      stockCode: string;
      shortName: string;
      price: string;
      prevClose: string | null;
      volume: string;
      provenance: ProvenanceClass;
    }> = await this.dataSource.query(
      `
      WITH ranked AS (
        SELECT
          pb.instrument_id,
          i.stock_code,
          i.short_name,
          pb.close,
          pb.volume,
          pb.ingestion_run_id,
          ROW_NUMBER() OVER (PARTITION BY pb.instrument_id ORDER BY pb.trade_date DESC) AS rn,
          LEAD(pb.close) OVER (PARTITION BY pb.instrument_id ORDER BY pb.trade_date DESC) AS prev_close
        FROM price_bars pb
        JOIN instruments i ON i.id = pb.instrument_id
        JOIN companies c ON c.id = i.company_id
        WHERE c.board IN ('MAIN', 'ACE')
      )
      SELECT
        r.stock_code AS "stockCode",
        r.short_name AS "shortName",
        r.close AS "price",
        r.prev_close AS "prevClose",
        r.volume AS "volume",
        ir.provenance_class AS "provenance"
      FROM ranked r
      JOIN ingestion_runs ir ON ir.id = r.ingestion_run_id
      WHERE r.rn = 1
      `,
    );

    const board: MoverRow[] = rows.map((r) => {
      const latestClose = Number(r.price);
      const prevClose = r.prevClose !== null ? Number(r.prevClose) : null;
      return {
        provenance: r.provenance,
        stockCode: r.stockCode,
        shortName: r.shortName,
        price: r.price,
        pctChange: prevClose !== null ? pctChange(latestClose, prevClose) : null,
        volume: Number(r.volume),
      };
    });

    return board.sort(MOVERS_COMPARATORS[type]);
  }

  // ─── Indices (ticket 05) ──────────────────────────────────────────────────

  /**
   * `GET /market/indices` — the headline + sector index panel.
   *
   * During market hours: Redis only (class 3), UNCONDITIONALLY — see
   * `loadLiveIndices`. Outside hours: the latest stored `IndexLevel` for each
   * index, cached via the class-2 read-through.
   */
  async getIndices(): Promise<IndicesResponse> {
    if (isMarketHours(this.clock())) {
      const indices = await this.loadLiveIndices();
      return { indices };
    }
    const indices = await this.readCache.remember(indicesCacheKey(), () =>
      this.loadStoredIndices(),
    );
    return { indices };
  }

  /**
   * During market hours: overlay LIVE Redis levels onto the identity fields
   * (`id`, `kind`, `name`, `sectorName`, `provenance`) of the last-cached
   * OUTSIDE-hours response — never a fresh Postgres read. Those identity
   * fields only change on a nightly ingest, which sweeps this very cache key,
   * so reusing it is always correct, not stale.
   *
   * If the cache is cold (e.g. a Redis flush with no outside-hours traffic
   * since), this returns an empty panel rather than touching Postgres — the
   * same "no tick yet, serve an empty board" posture ticket 03/04 established
   * for an absent movers board. In practice the cache warms on the first
   * outside-hours request of the ~13h closed window before market open, so a
   * cold catalog at market open is a rare edge, not the steady state.
   */
  private async loadLiveIndices(): Promise<IndexEntry[]> {
    // `indicesCacheKey()` caches exactly `loadStoredIndices`'s return value —
    // an `IndexEntry[]`, not an `IndicesResponse` — so the peek reads the same
    // shape back.
    const lastKnown = await this.readCache.get<IndexEntry[]>(indicesCacheKey());
    if (!lastKnown) return [];

    const entries: IndexEntry[] = [];
    for (const base of lastKnown) {
      const raw = await this.redis.get(
        IntradayReplayService.indexKey(base.kind, base.sectorName),
      );
      if (!raw) continue; // no live tick yet for this index — skip gracefully
      const tick = JSON.parse(raw) as LiveIndexLevelTick;
      entries.push({ ...base, level: tick.level, pctChange: tick.pctChange });
    }
    return entries;
  }

  /** Read the latest stored `IndexLevel` for each `MarketIndex` (class 2 — outside hours). */
  private async loadStoredIndices(): Promise<IndexEntry[]> {
    const marketIndices = await this.dataSource.getRepository(MarketIndex).find({
      relations: { sector: true, ingestionRun: true },
      order: { kind: 'ASC' },
    });

    const entries: IndexEntry[] = [];
    for (const mi of marketIndices) {
      // Load the 2 most recent stored levels (DESC order) — latest + prev.
      const levels = await this.dataSource
        .getRepository(IndexLevel)
        .find({
          where: { indexId: mi.id },
          order: { levelDate: 'DESC' },
          take: 2,
        });
      const latest = levels[0];
      const prev = levels[1];
      if (!latest) continue; // no levels yet — skip gracefully
      const latestLevel = Number(latest.level);
      const prevLevel = prev ? Number(prev.level) : null;
      entries.push({
        id: mi.id,
        kind: mi.kind,
        name: mi.name,
        sectorName: mi.sector?.name ?? null,
        level: latest.level,
        pctChange: prevLevel !== null ? pctChange(latestLevel, prevLevel) : null,
        provenance: mi.ingestionRun.provenanceClass,
      });
    }
    return entries;
  }

  // ─── Index series (ticket 05) ─────────────────────────────────────────────

  /**
   * `GET /market/indices/:id/series?range=` — the chartable `IndexLevel`
   * history for one index (Postgres, class 2).
   *
   * `range` clamps/drops (never a 400); an `id` that isn't even UUID-shaped,
   * or doesn't resolve to a `MarketIndex`, both 404 — a malformed id would
   * otherwise fail the Postgres `uuid` cast with a 500.
   */
  async getIndexSeries(
    id: string,
    rawRange: string | undefined,
  ): Promise<IndexSeriesResponse> {
    if (!isUuid(id)) {
      throw new NotFoundException(`No index found for id=${id}`);
    }
    const { range, days } = resolveSeriesRange(rawRange);
    // The 404 path is NOT cached (thrown through the loader, stocks-service
    // precedent) — a bad id never poisons a cache key.
    return this.readCache.remember(seriesCacheKey(id, range), () =>
      this.loadIndexSeries(id, range, days),
    );
  }

  private async loadIndexSeries(
    id: string,
    range: import('./index-params').IndexSeriesRange,
    days: number | null,
  ): Promise<IndexSeriesResponse> {
    const mi = await this.dataSource.getRepository(MarketIndex).findOne({
      where: { id },
      relations: { ingestionRun: true },
    });
    if (!mi) {
      throw new NotFoundException(`No index found for id=${id}`);
    }

    const levels = await this.dataSource.getRepository(IndexLevel).find({
      where: { indexId: id },
      order: { levelDate: 'ASC' },
    });

    // The lookback anchors to the SERIES' OWN latest stored date, never the
    // wall clock (`index-params.ts` header) — a fixed historical backfill
    // must not drift out of every range as real time passes.
    const latestLevelDate = levels.length > 0 ? levels[levels.length - 1]!.levelDate : null;
    const sinceDate = seriesSinceDate(latestLevelDate, days);
    const windowed = sinceDate === null ? levels : levels.filter((l) => l.levelDate >= sinceDate);

    return {
      id: mi.id,
      name: mi.name,
      range,
      points: windowed.map((l) => ({ levelDate: l.levelDate, level: l.level })),
      provenance: mi.ingestionRun.provenanceClass,
    };
  }

  // ─── Sectors (ticket 05) ──────────────────────────────────────────────────

  /**
   * `GET /market/sectors` — the sector-performance board.
   *
   * Derived from `getIndices()` by filtering to `kind = sector` — the exact
   * same clock selection, cache entry, and live-overlay machinery as the
   * headline index, so the two surfaces can never disagree (no separate
   * sector-shaped Redis/Postgres path to drift) and there is no request-time
   * aggregation: sector indices are first-class `MarketIndex` rows already.
   */
  async getSectors(): Promise<SectorsResponse> {
    const { indices } = await this.getIndices();
    const sectors: SectorEntry[] = indices
      .filter(
        (entry): entry is IndexEntry & { sectorName: string } =>
          entry.kind === MarketIndexKind.Sector && entry.sectorName !== null,
      )
      .map((entry) => ({
        indexId: entry.id,
        sectorName: entry.sectorName,
        level: entry.level,
        pctChange: entry.pctChange,
        provenance: entry.provenance,
      }));
    return { sectors };
  }
}
