/**
 * Stock-page HTTP surface (spec 02; ticket 03; category/type filters added by
 * spec 04 ticket 02; PoC Phase A series + analysis reads by build ticket 06):
 *
 *   GET /stocks/:code                        → core snapshot (shape B)
 *   GET /stocks/:code/announcements?category&offset=&limit= → newest-first page
 *   GET /stocks/:code/corporate-actions?type&offset=&limit= → chronological page
 *   GET /stocks/:code/series?interval=1d&range=2y → EOD OHLC series
 *   GET /stocks/:code/analysis/technical     → thin TA envelope
 *   GET /stocks/:code/analysis/fundamental   → thin FA envelope
 *   GET /stocks/:code/analysis/technical/artifact → proxied rich JSON (cost stripped)
 *   GET /stocks/:code/analysis/fundamental/artifact → proxied rich JSON (cost stripped)
 *
 * Deliberately carries NO `@RequiresJob`: these are free-tier / PoC browse
 * routes — the global TierGuard passes any route without it (ADR-0005).
 */

import { Controller, Get, Param, Query } from '@nestjs/common';
import { parseEnumList } from './filters';
import { resolvePagination } from './pagination';
import { StocksService } from './stocks.service';
import { AnnouncementCategory, CorporateActionType } from '../data/entities/enums';
import type {
  AnnouncementsPage,
  CorporateActionsPage,
  StockCorePayload,
  StockFundamentalAnalysisResponse,
  StockSeriesResponse,
  StockTechnicalAnalysisResponse,
} from './stocks.types';

@Controller('stocks')
export class StocksController {
  constructor(private readonly stocks: StocksService) {}

  /**
   * Announcements for the stock, newest `filedAt` first. `?category=` is a
   * one-or-more comma-separated filter (spec 04 §1; invalid tokens dropped).
   */
  @Get(':code/announcements')
  async getAnnouncements(
    @Param('code') code: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
    @Query('category') category?: string,
  ): Promise<AnnouncementsPage> {
    const page = resolvePagination(offset, limit);
    const categories = parseEnumList(category, Object.values(AnnouncementCategory));
    return this.stocks.getAnnouncements(code, page.offset, page.limit, categories);
  }

  /** Corporate actions for the stock, chronological `exDate` ascending (`?type=` filter, spec 04). */
  @Get(':code/corporate-actions')
  async getCorporateActions(
    @Param('code') code: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
    @Query('type') type?: string,
  ): Promise<CorporateActionsPage> {
    const page = resolvePagination(offset, limit);
    const types = parseEnumList(type, Object.values(CorporateActionType));
    return this.stocks.getCorporateActions(code, page.offset, page.limit, types);
  }

  /** PoC-fixed ~2y EOD OHLC series (`interval=1d` / `range=2y` only). */
  @Get(':code/series')
  async getSeries(
    @Param('code') code: string,
    @Query('interval') interval?: string,
    @Query('range') range?: string,
  ): Promise<StockSeriesResponse> {
    return this.stocks.getSeries(code, interval, range);
  }

  @Get(':code/analysis/technical/artifact')
  async getTechnicalArtifact(
    @Param('code') code: string,
  ): Promise<Record<string, unknown>> {
    return this.stocks.getTechnicalArtifact(code);
  }

  @Get(':code/analysis/fundamental/artifact')
  async getFundamentalArtifact(
    @Param('code') code: string,
  ): Promise<Record<string, unknown>> {
    return this.stocks.getFundamentalArtifact(code);
  }

  @Get(':code/analysis/technical')
  async getTechnicalAnalysis(
    @Param('code') code: string,
  ): Promise<StockTechnicalAnalysisResponse> {
    return this.stocks.getTechnicalAnalysis(code);
  }

  @Get(':code/analysis/fundamental')
  async getFundamentalAnalysis(
    @Param('code') code: string,
  ): Promise<StockFundamentalAnalysisResponse> {
    return this.stocks.getFundamentalAnalysis(code);
  }

  /** The bounded core snapshot — one round trip, identity ⋈ fundamentals ⋈ technicals ⋈ shariah. */
  @Get(':code')
  async getCore(@Param('code') code: string): Promise<StockCorePayload> {
    return this.stocks.getCore(code);
  }
}
