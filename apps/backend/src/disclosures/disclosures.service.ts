/**
 * Disclosure read-surface composition service (spec 04; ticket 02).
 *
 * Pure read projection over the already-ingested Postgres model (spec 01) —
 * no JobBus, no writes. Four read models (`Announcement`, `CorporateAction`,
 * `QuarterlyFinancials`, `NewsArticle` + its tags) projected into the market
 * announcements feed, the dealings view (the same rows filtered to
 * `SHAREHOLDING_CHANGE`), the two derived calendars (no new entity), and the
 * tagged news feed.
 *
 * Every row is `aggregator`-class (the demo disclosure + RSS snapshot, tagged
 * in-house) — the primary decision-B purge target; the read-time
 * "illustrative" label is the per-row lineage join, never a per-row column.
 *
 * Caching is class-2 read-through (ADR-0004) under the
 * `cache:disclosures:` prefix, keyed by normalised params; the nightly
 * ingest (the demo disclosure/RSS cadence) and the decision-B purge sweep
 * the prefix after commit (ticket 01).
 *
 * Unknown `companyCode` in a filter position is filter semantics, not a
 * resource lookup → an empty page (only the per-company spec-02 routes and
 * `getAnnouncementById` 404).
 *
 * This service itself still does no JobBus/writes; the sibling
 * `AnnouncementSummaryStore` (spec 06, ticket 03) is the module's one
 * JobBus-subscribing writer, kept separate so this composition service stays
 * a pure read projection.
 */

import { Injectable } from '@nestjs/common';
import {
  Between,
  DataSource,
  In,
  LessThanOrEqual,
  MoreThanOrEqual,
} from 'typeorm';
import { ReadCacheService, DISCLOSURES_CACHE_PREFIX } from '../cache';
import { Announcement } from '../data/entities/announcement.entity';
import { CorporateAction } from '../data/entities/corporate-action.entity';
import { Instrument } from '../data/entities/instrument.entity';
import { NewsArticle } from '../data/entities/news-article.entity';
import { NewsArticleTag } from '../data/entities/news-article-tag.entity';
import { QuarterlyFinancials } from '../data/entities/quarterly-financials.entity';
import {
  AnnouncementCategory,
  CorporateActionType,
} from '../data/entities/enums';
import { endOfUtcDay, isUuid } from '../stocks/filters';
import { toNumber } from '../stocks/serialisation';
import { resolveCalendarWindow } from './calendar-window';
import type {
  AnnouncementDetail,
  CorporateActionCalendarWindow,
  MarketAnnouncementsPage,
  NewsPage,
  ResultsCalendarItem,
  ResultsCalendarWindow,
} from './disclosures.types';

/** Input of the market-wide announcements feed / the dealings view. */
export interface AnnouncementsFeedQuery {
  offset: number;
  limit: number;
  companyCode?: string;
  /** Inclusive ISO `YYYY-MM-DD` bounds on `filedAt`; null when unfiltered. */
  from: Date | null;
  to: Date | null;
}

/** Input of the corporate-actions calendar. */
export interface CorporateActionCalendarQuery {
  /** Raw `from`/`to` bounds — resolved against the default window (7 back/+30 ahead). */
  rawFrom?: string;
  rawTo?: string;
  companyCode?: string;
  types: readonly CorporateActionType[];
}

/** Input of the results calendar. */
export interface ResultsCalendarQuery {
  companyCode?: string;
  from: Date | null;
  to: Date | null;
}

/** Input of the tagged news feed (`companyCode` omitted = market-level). */
export interface NewsQuery {
  offset: number;
  limit: number;
  companyCode?: string;
}

@Injectable()
export class DisclosuresService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly readCache: ReadCacheService,
  ) {}

  /** `GET /announcements` — market-wide feed, `filedAt` desc, class-2 page cache. */
  async getMarketAnnouncements(
    query: AnnouncementsFeedQuery,
    categories: readonly AnnouncementCategory[] = [],
  ): Promise<MarketAnnouncementsPage> {
    return this.readCache.remember(
      this.key('announcements', categories, query),
      () => this.loadAnnouncementsFeed(query, categories),
    );
  }

  /**
   * `GET /disclosures/dealings` — the substantial-shareholder/director
   * dealings feed: the SAME rows as the market feed filtered to
   * `SHAREHOLDING_CHANGE` (spec 04 §4 — a view, not a new entity).
   */
  async getDealings(query: AnnouncementsFeedQuery): Promise<MarketAnnouncementsPage> {
    return this.readCache.remember(
      this.key('dealings', [AnnouncementCategory.ShareholdingChange], query),
      () =>
        this.loadAnnouncementsFeed(
          query,
          [AnnouncementCategory.ShareholdingChange],
        ),
    );
  }

  /** `GET /calendar/corporate-actions` — derived calendar, `exDate` axis, default 7-back/+30-ahead. */
  async getCorporateActionCalendar(
    query: CorporateActionCalendarQuery,
  ): Promise<CorporateActionCalendarWindow> {
    const window = resolveCalendarWindow(query.rawFrom, query.rawTo);
    return this.readCache.remember(
      `${DISCLOSURES_CACHE_PREFIX}calendar:corporate-actions:${window.from}:${window.to}:${query.types.slice().sort().join(',')}:${query.companyCode ?? ''}`,
      () => this.loadCorporateActionCalendar(query, window),
    );
  }

  /** `GET /calendar/results` — backward-looking when-filed calendar, `reportedAt` desc. */
  async getResultsCalendar(
    query: ResultsCalendarQuery,
  ): Promise<ResultsCalendarWindow> {
    return this.readCache.remember(
      `${DISCLOSURES_CACHE_PREFIX}calendar:results:${isoDay(query.from) ?? ''}:${isoDay(query.to) ?? ''}:${query.companyCode ?? ''}`,
      () => this.loadResultsCalendar(query),
    );
  }

  /** `GET /news` — company-tagged feed; `companyCode` omitted = market-level news. */
  async getNews(query: NewsQuery): Promise<NewsPage> {
    return this.readCache.remember(
      `${DISCLOSURES_CACHE_PREFIX}news:${query.companyCode ?? 'market'}:${query.offset}:${query.limit}`,
      () => this.loadNews(query),
    );
  }

  /**
   * `GET /announcements/:id` — one announcement's own fields (spec 06, ticket
   * 03): the `summarize-announcement` Python job's only route to an
   * announcement's content. Uncached (a single-row point lookup, read once
   * per summarization job) — an `:id` that isn't even UUID-shaped, or doesn't
   * resolve to a row, both return `null` (the controller 404s).
   */
  async getAnnouncementById(id: string): Promise<AnnouncementDetail | null> {
    if (!isUuid(id)) return null;
    const row = await this.dataSource.getRepository(Announcement).findOne({
      where: { id },
      relations: { company: true, ingestionRun: true },
    });
    if (!row) return null;

    const codes = await this.companyCodesByCompanyId([row.companyId]);
    return {
      id: row.id,
      provenance: row.ingestionRun.provenanceClass,
      companyCode: codes.get(row.companyId)?.companyCode ?? '',
      companyName: row.company.fullName,
      category: row.category,
      title: row.title,
      filedAt: row.filedAt.toISOString(),
      sourceUrl: row.sourceUrl,
      aiSummary: row.aiSummary,
      aiSummaryAsOf: row.aiSummaryAsOf === null ? null : row.aiSummaryAsOf.toISOString(),
    };
  }

  // ---------------------------------------------------------------- reads

  /** The shared market-feed / dealings-view query over `Announcement`. */
  private async loadAnnouncementsFeed(
    query: AnnouncementsFeedQuery,
    categories: readonly AnnouncementCategory[],
  ): Promise<MarketAnnouncementsPage> {
    const companyId = await this.resolveCompanyId(query.companyCode);
    // A supplied-but-unknown companyCode is filter semantics → empty page.
    if (companyId === null) {
      return { items: [], total: 0, offset: query.offset, limit: query.limit };
    }

    const [rows, total] = await this.dataSource
      .getRepository(Announcement)
      .findAndCount({
        where: {
          ...(companyId !== undefined ? { companyId } : {}),
          ...(categories.length > 0 ? { category: In(categories) } : {}),
          ...(query.from ? { filedAt: MoreThanOrEqual(query.from) } : {}),
          ...(query.to ? { filedAt: LessThanOrEqual(endOfUtcDay(query.to)) } : {}),
        },
        relations: { company: true, ingestionRun: true },
        // id tiebreaker so equal filedAt rows cannot shuffle across pages.
        order: { filedAt: 'DESC', id: 'DESC' },
        skip: query.offset,
        take: query.limit,
      });

    const codes = await this.companyCodesByCompanyId(
      rows.map((r) => r.companyId),
    );
    const items = rows.map((a) => ({
      provenance: a.ingestionRun.provenanceClass,
      companyCode: codes.get(a.companyId)?.companyCode ?? '',
      companyName: a.company.fullName,
      category: a.category,
      title: a.title,
      filedAt: a.filedAt.toISOString(),
      sourceUrl: a.sourceUrl,
      aiSummary: a.aiSummary,
      aiSummaryAsOf: a.aiSummaryAsOf === null ? null : a.aiSummaryAsOf.toISOString(),
    }));
    return { items, total, offset: query.offset, limit: query.limit };
  }

  /** The corporate-actions calendar over `CorporateAction`, `exDate` ascending. */
  private async loadCorporateActionCalendar(
    query: CorporateActionCalendarQuery,
    window: { from: string; to: string },
  ): Promise<CorporateActionCalendarWindow> {
    const companyId = await this.resolveCompanyId(query.companyCode);
    if (companyId === null) return { ...window, items: [] };

    const rows = await this.dataSource.getRepository(CorporateAction).find({
      where: {
        // exDate is a date column — the resolved window as inclusive ISO-string bounds.
        exDate: Between(window.from, window.to),
        ...(query.types.length > 0 ? { type: In(query.types) } : {}),
        ...(companyId !== undefined ? { companyId } : {}),
      },
      relations: { company: true, ingestionRun: true },
      order: { exDate: 'ASC', id: 'ASC' },
    });

    const codes = await this.companyCodesByCompanyId(
      rows.map((r) => r.companyId),
    );
    const items = rows.map((c) => ({
      provenance: c.ingestionRun.provenanceClass,
      companyCode: codes.get(c.companyId)?.companyCode ?? '',
      companyName: c.company.fullName,
      type: c.type,
      exDate: c.exDate,
      amount: toNumber(c.amount),
    }));
    return { ...window, items };
  }

  /**
   * The results calendar over `QuarterlyFinancials` — **backward-looking**:
   * when each quarter's results were FILED. The link is the company's
   * earliest `FINANCIAL_RESULTS` announcement filed on/after the quarter's
   * `periodEnd` (a read-time join, not an FK — the demo adapter files exactly
   * one per quarter, so the join is exact; a licensed structured feed can
   * tighten it). Quarters with no filed announcement are not on a when-filed
   * calendar; `reportedAt`'s provenance is the announcement's lineage.
   */
  private async loadResultsCalendar(
    query: ResultsCalendarQuery,
  ): Promise<ResultsCalendarWindow> {
    const companyId = await this.resolveCompanyId(query.companyCode);
    if (companyId === null) {
      return { from: isoDay(query.from), to: isoDay(query.to), items: [] };
    }

    const [quarters, announcements] = await Promise.all([
      this.dataSource.getRepository(QuarterlyFinancials).find({
        ...(companyId !== undefined ? { where: { companyId } } : {}),
        relations: { company: true },
        order: { periodEnd: 'DESC', id: 'DESC' },
      }),
      this.dataSource.getRepository(Announcement).find({
        where: {
          category: AnnouncementCategory.FinancialResults,
          ...(companyId !== undefined ? { companyId } : {}),
        },
        relations: { ingestionRun: true },
        order: { filedAt: 'ASC', id: 'ASC' },
      }),
    ]);
    const codes = await this.companyCodesByCompanyId(
      [...new Set(quarters.map((q) => q.companyId))],
    );

    const items: ResultsCalendarItem[] = [];
    for (const quarter of quarters) {
      const periodEnd = new Date(`${quarter.periodEnd}T00:00:00.000Z`);
      // The QUARTER'S OWN COMPANY'S earliest results filing at/after the
      // period end reports this quarter (never another company's filing).
      const link = announcements.find(
        (a) => a.companyId === quarter.companyId && a.filedAt >= periodEnd,
      );
      if (!link) continue; // unfiled quarter — not on a when-filed calendar
      const reportedAt = link.filedAt;
      if (query.from && reportedAt < query.from) continue;
      if (query.to && reportedAt > endOfUtcDay(query.to)) continue;
      items.push({
        provenance: link.ingestionRun.provenanceClass,
        companyCode: codes.get(quarter.companyId)?.companyCode ?? '',
        companyName: quarter.company.fullName,
        fiscalYear: quarter.fiscalYear,
        fiscalQuarter: quarter.fiscalQuarter,
        periodEnd: quarter.periodEnd,
        reportedAt: reportedAt.toISOString(),
        announcement: {
          title: link.title,
          filedAt: link.filedAt.toISOString(),
          sourceUrl: link.sourceUrl,
        },
      });
    }

    // reportedAt desc (the in-memory join result), deterministic tiebreak.
    items.sort(
      (a, b) =>
        (a.reportedAt < b.reportedAt ? 1 : a.reportedAt > b.reportedAt ? -1 : 0) ||
        (a.companyCode < b.companyCode ? -1 : a.companyCode > b.companyCode ? 1 : 0),
    );
    return { from: isoDay(query.from), to: isoDay(query.to), items };
  }

  /** The tagged news feed: one company's tagged headlines, or market-level rows. */
  private async loadNews(query: NewsQuery): Promise<NewsPage> {
    if (query.companyCode !== undefined) {
      const companyId = await this.resolveCompanyId(query.companyCode);
      if (companyId === null) {
        return { items: [], total: 0, offset: query.offset, limit: query.limit };
      }
      // Paginate over the company's TAG rows (one per article × company).
      const [tags, total] = await this.dataSource
        .getRepository(NewsArticleTag)
        .findAndCount({
          where: { companyId },
          relations: { newsArticle: { ingestionRun: true } },
          order: { newsArticle: { publishedAt: 'DESC' }, id: 'DESC' },
          skip: query.offset,
          take: query.limit,
        });
      const items = tags.map((t) => ({
        provenance: t.newsArticle.ingestionRun.provenanceClass,
        headline: t.newsArticle.headline,
        url: t.newsArticle.url,
        source: t.newsArticle.source,
        publishedAt: t.newsArticle.publishedAt.toISOString(),
        matchedAlias: t.matchedAlias,
      }));
      return { items, total, offset: query.offset, limit: query.limit };
    }

    // Market-level feed: articles with NO tags (conservative tagging fallout).
    const [rows, total] = await this.dataSource
      .getRepository(NewsArticle)
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.ingestionRun', 'run')
      .where((qb) => {
        const sub = qb
          .subQuery()
          .select('1')
          .from(NewsArticleTag, 't')
          .where('t.news_article_id = a.id')
          .getQuery();
        return `NOT EXISTS ${sub}`;
      })
      .orderBy('a.publishedAt', 'DESC')
      .addOrderBy('a.id', 'DESC')
      .skip(query.offset)
      .take(query.limit)
      .getManyAndCount();
    const items = rows.map((a) => ({
      provenance: a.ingestionRun.provenanceClass,
      headline: a.headline,
      url: a.url,
      source: a.source,
      publishedAt: a.publishedAt.toISOString(),
    }));
    return { items, total, offset: query.offset, limit: query.limit };
  }

  // ------------------------------------------------------------- helpers

  /**
   * Resolve a `companyCode` filter to a companyId.
   * `undefined` (no filter) → `undefined`; a known code → the id; a supplied
   * but unknown code → `null` (filter semantics: empty page).
   */
  private async resolveCompanyId(
    companyCode: string | undefined,
  ): Promise<string | undefined | null> {
    if (companyCode === undefined) return undefined;
    const instrument = await this.dataSource
      .getRepository(Instrument)
      .findOne({ where: { stockCode: companyCode } });
    return instrument?.companyId ?? null;
  }

  /**
   * `companyId → { companyCode }` map via the companies' ordinary-share
   * instruments (the code lives on the Instrument; first instrument wins —
   * the analysed universe is one ordinary instrument per company).
   */
  private async companyCodesByCompanyId(
    companyIds: readonly string[],
  ): Promise<Map<string, { companyCode: string }>> {
    if (companyIds.length === 0) return new Map();
    const instruments = await this.dataSource
      .getRepository(Instrument)
      .find({ where: { companyId: In([...new Set(companyIds)]) } });
    const map = new Map<string, { companyCode: string }>();
    for (const instrument of instruments) {
      if (!map.has(instrument.companyId)) {
        map.set(instrument.companyId, { companyCode: instrument.stockCode });
      }
    }
    return map;
  }

  /** Class-2 cache key for a feed query: normalised categories + filters + page. */
  private key(
    name: string,
    categories: readonly string[],
    query: AnnouncementsFeedQuery,
  ): string {
    return `${DISCLOSURES_CACHE_PREFIX}${name}:${categories.slice().sort().join(',')}:${query.companyCode ?? ''}:${isoDay(query.from) ?? ''}:${isoDay(query.to) ?? ''}:${query.offset}:${query.limit}`;
  }
}

/** ISO `YYYY-MM-DD` of a UTC-midnight date; null → null (cache-key fragment). */
function isoDay(date: Date | null): string | null {
  return date === null ? null : date.toISOString().slice(0, 10);
}
