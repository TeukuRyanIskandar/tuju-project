/**
 * Market-overview HTTP surface (spec 05, tickets 04 + 05).
 *
 *   GET /market/movers?type=gainers|losers|actives&limit=
 *   GET /market/indices
 *   GET /market/indices/:id/series?range=
 *   GET /market/sectors
 *
 * Deliberately carries NO `@RequiresJob`: anonymous free-tier browsing
 * (ADR-0005) — the global TierGuard passes any route without it, same as the
 * other spec-02/03/04/05 read surfaces.
 *
 * The controller only picks params and delegates; all resolution (clamp/drop,
 * never a 400), cache-class selection, and provenance labelling live in
 * `MarketService`.
 */

import { Controller, Get, Param, Query } from '@nestjs/common';
import { rawMoversParams } from './movers-params';
import { MarketService } from './market.service';
import type {
  IndicesResponse,
  IndexSeriesResponse,
  MoversResponse,
  SectorsResponse,
} from './market.types';

@Controller('market')
export class MarketController {
  constructor(private readonly market: MarketService) {}

  /**
   * `GET /market/movers?type=gainers|losers|actives&limit=`
   *
   * The "what's moving today" panel. During market hours: the precomputed
   * Redis board (class 3). Outside hours: the EOD-close fallback (class 2).
   * Params clamp/drop — never a 400.
   */
  @Get('movers')
  async movers(@Query() query: unknown): Promise<MoversResponse> {
    return this.market.getMovers(rawMoversParams(query));
  }

  /**
   * `GET /market/indices`
   *
   * Headline + sector index panel with current level + %change. Live during
   * market hours (Redis class 3); latest stored outside (Postgres class 2).
   */
  @Get('indices')
  async indices(): Promise<IndicesResponse> {
    return this.market.getIndices();
  }

  /**
   * `GET /market/indices/:id/series?range=`
   *
   * The stored `IndexLevel` history for one index — the chartable sparkline
   * data. `range` clamps/drops (never a 400); unknown `id` → 404.
   */
  @Get('indices/:id/series')
  async indexSeries(
    @Param('id') id: string,
    @Query('range') range: string | undefined,
  ): Promise<IndexSeriesResponse> {
    return this.market.getIndexSeries(id, range);
  }

  /**
   * `GET /market/sectors`
   *
   * The sector-performance board: per-Sector `%change` from that sector's
   * index. Same live/stored clock selection as `/market/indices`.
   */
  @Get('sectors')
  async sectors(): Promise<SectorsResponse> {
    return this.market.getSectors();
  }
}
