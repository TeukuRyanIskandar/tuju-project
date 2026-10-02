/**
 * Disclosure read-surface HTTP surface (spec 04 ticket 02; spec 06 ticket 03)
 * — six anonymous read endpoints over the already-ingested model:
 *
 *   GET /announcements?category&companyCode&from&to&limit&offset= → market-wide feed
 *   GET /announcements/:id                                        → one announcement's own fields
 *   GET /disclosures/dealings?companyCode&from&to&limit&offset=  → insider-dealings feed
 *   GET /calendar/corporate-actions?from&to&type&companyCode=    → exDate calendar
 *   GET /calendar/results?from&to&companyCode=                     → when-filed calendar
 *   GET /news?companyCode&limit&offset=                           → tagged / market news
 *
 * Deliberately carries NO `@RequiresJob`: these are free-tier browse routes —
 * the global TierGuard passes any route without it (ADR-0005), same as the
 * spec-02 stock page. The controller only resolves query params (clamp, never
 * 400 — same posture as `stocks/pagination`) and delegates; composition,
 * provenance and the class-2 cache live in `DisclosuresService`.
 */

import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import {
  AnnouncementCategory,
  CorporateActionType,
} from '../data/entities/enums';
import { parseEnumList, parseIsoDate } from '../stocks/filters';
import { resolvePagination } from '../stocks/pagination';
import { DisclosuresService } from './disclosures.service';
import type {
  AnnouncementDetail,
  CorporateActionCalendarWindow,
  MarketAnnouncementsPage,
  NewsPage,
  ResultsCalendarWindow,
} from './disclosures.types';

@Controller()
export class DisclosuresController {
  constructor(private readonly disclosures: DisclosuresService) {}

  /**
   * Market-wide announcements feed, `filedAt` desc. `?category=` is a
   * one-or-more comma-separated filter (invalid tokens dropped, never a 400);
   * flat rows carry the category field — no server-side grouped payload.
   */
  @Get('announcements')
  async getAnnouncements(
    @Query('category') category?: string,
    @Query('companyCode') companyCode?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ): Promise<MarketAnnouncementsPage> {
    const page = resolvePagination(offset, limit);
    return this.disclosures.getMarketAnnouncements(
      {
        offset: page.offset,
        limit: page.limit,
        companyCode,
        from: parseIsoDate(from),
        to: parseIsoDate(to),
      },
      parseEnumList(category, Object.values(AnnouncementCategory)),
    );
  }

  /**
   * One announcement's own fields (spec 06, ticket 03) — the
   * `summarize-announcement` Python job's only route to an announcement's
   * content; unknown/malformed `:id` → 404 (a resource lookup, unlike the
   * filter-semantics `companyCode` above).
   */
  @Get('announcements/:id')
  async getAnnouncementById(
    @Param('id') id: string,
  ): Promise<AnnouncementDetail> {
    const item = await this.disclosures.getAnnouncementById(id);
    if (!item) {
      throw new NotFoundException(`No announcement found for id=${id}`);
    }
    return item;
  }

  /**
   * Substantial-shareholder / director dealings feed — the announcements
   * feed's `SHAREHOLDING_CHANGE` rows (same rows, list-level fields only;
   * structured buyer/seller/volume/price fields wait for the licensed form).
   */
  @Get('disclosures/dealings')
  async getDealings(
    @Query('companyCode') companyCode?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ): Promise<MarketAnnouncementsPage> {
    const page = resolvePagination(offset, limit);
    return this.disclosures.getDealings({
      offset: page.offset,
      limit: page.limit,
      companyCode,
      from: parseIsoDate(from),
      to: parseIsoDate(to),
    });
  }

  /**
   * Corporate-actions calendar keyed on `exDate` (dividends, bonuses,
   * splits, rights). Default window = next 30 days + 7 back; `?type=` is a
   * one-or-more comma-separated filter.
   */
  @Get('calendar/corporate-actions')
  async getCorporateActionCalendar(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('type') type?: string,
    @Query('companyCode') companyCode?: string,
  ): Promise<CorporateActionCalendarWindow> {
    return this.disclosures.getCorporateActionCalendar({
      rawFrom: from,
      rawTo: to,
      companyCode,
      types: parseEnumList(type, Object.values(CorporateActionType)),
    });
  }

  /**
   * Results calendar — **backward-looking**: when companies FILED quarterly
   * results, `reportedAt` desc. (Forward earnings-date estimation needs a
   * licensed source and is out of scope.)
   */
  @Get('calendar/results')
  async getResultsCalendar(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('companyCode') companyCode?: string,
  ): Promise<ResultsCalendarWindow> {
    return this.disclosures.getResultsCalendar({
      companyCode,
      from: parseIsoDate(from),
      to: parseIsoDate(to),
    });
  }

  /**
   * News feed: headlines tagged to `?companyCode=`'s company; `companyCode`
   * omitted = market-level news (the untagged conservative-tagging fallout).
   */
  @Get('news')
  async getNews(
    @Query('companyCode') companyCode?: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ): Promise<NewsPage> {
    const page = resolvePagination(offset, limit);
    return this.disclosures.getNews({
      offset: page.offset,
      limit: page.limit,
      companyCode,
    });
  }
}
