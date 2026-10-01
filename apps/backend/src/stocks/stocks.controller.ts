/**
 * Stock-page HTTP surface (spec 02; ticket 03) — three anonymous read
 * endpoints over the already-ingested model:
 *
 *   GET /stocks/:code                        → core snapshot (shape B)
 *   GET /stocks/:code/announcements?offset= → newest-first disclosure page
 *   GET /stocks/:code/corporate-actions?offset= → chronological disclosure page
 *
 * Deliberately carries NO `@RequiresJob`: these are free-tier browse routes —
 * the global TierGuard passes any route without it (ADR-0005). The controller
 * only resolves query params and delegates; composition, provenance and the
 * class-2 cache live in `StocksService`.
 */

import { Controller, Get, Param, Query } from '@nestjs/common';
import { resolvePagination } from './pagination';
import { StocksService } from './stocks.service';
import type {
  AnnouncementsPage,
  CorporateActionsPage,
  StockCorePayload,
} from './stocks.types';

@Controller('stocks')
export class StocksController {
  constructor(private readonly stocks: StocksService) {}

  /** The bounded core snapshot — one round trip, identity ⋈ fundamentals ⋈ technicals ⋈ shariah. */
  @Get(':code')
  async getCore(@Param('code') code: string): Promise<StockCorePayload> {
    return this.stocks.getCore(code);
  }

  /** Announcements for the stock, newest `filedAt` first. */
  @Get(':code/announcements')
  async getAnnouncements(
    @Param('code') code: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ): Promise<AnnouncementsPage> {
    const page = resolvePagination(offset, limit);
    return this.stocks.getAnnouncements(code, page.offset, page.limit);
  }

  /** Corporate actions for the stock, chronological `exDate` ascending. */
  @Get(':code/corporate-actions')
  async getCorporateActions(
    @Param('code') code: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ): Promise<CorporateActionsPage> {
    const page = resolvePagination(offset, limit);
    return this.stocks.getCorporateActions(code, page.offset, page.limit);
  }
}
