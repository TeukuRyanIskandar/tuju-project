/**
 * Stock-page composition service (spec 02 "Stock-page payload — endpoint shape
 * B"; ticket 03).
 *
 * Reads the already-ingested Postgres model (spec 01) into the bounded core
 * snapshot plus the two paginated disclosure lists. Ratios are READ from the
 * materialised `FundamentalsSnapshot` columns — never recomputed here — so the
 * stock page and the screener agree by construction. The only read-time
 * computations are `pctChange` (from the two latest EOD `PriceBar`s — the EOD
 * snapshot, never the 5-min intraday replay) and the `lossMaking` flag
 * (`ttmEps <= 0`; the stored P/E is already null on a loss-maker).
 *
 * Provenance (spec 02 "Illustrative labelling") is a per-block read-time
 * lineage join — each source row's `ingestionRunId → IngestionRun.provenanceClass`
 * — never a per-row column: identity/shariah resolve to `real`,
 * fundamentals/technicals to `synthetic`, disclosure items to `aggregator`.
 *
 * Caching is class-2 read-through (ADR-0004) via the ticket-01
 * `ReadCacheService`, keyed per code (+ page on the lists). A `NotFoundException`
 * for an unknown code is thrown THROUGH the loader — `remember` propagates
 * exceptions uncached — so a 404 never poisons a key and the hot path needs no
 * pre-flight existence query. Invalidation is NOT wired here: the nightly
 * ingest and the decision-B purge sweep the `cache:stocks:` prefix after commit
 * (ticket 01).
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { ReadCacheService, STOCKS_CACHE_PREFIX } from '../cache';
import { Announcement } from '../data/entities/announcement.entity';
import { CorporateAction } from '../data/entities/corporate-action.entity';
import { FundamentalsSnapshot } from '../data/entities/fundamentals-snapshot.entity';
import { IndicatorSnapshot } from '../data/entities/indicator-snapshot.entity';
import { Instrument } from '../data/entities/instrument.entity';
import { PriceBar } from '../data/entities/price-bar.entity';
import { ShariahStatus } from '../data/entities/shariah-status.entity';
import {
  AnnouncementCategory,
  CorporateActionType,
  ProvenanceClass,
} from '../data/entities/enums';
import { pctChange, toNumber } from './serialisation';
import type {
  AnnouncementsPage,
  AnnouncementItem,
  CorporateActionItem,
  CorporateActionsPage,
  FundamentalsBlock,
  IdentityBlock,
  ShariahBlock,
  StockCorePayload,
  TechnicalsBlock,
} from './stocks.types';

@Injectable()
export class StocksService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly readCache: ReadCacheService,
  ) {}

  /** `GET /stocks/:code` — the class-2-cached core snapshot. */
  async getCore(stockCode: string): Promise<StockCorePayload> {
    return this.readCache.remember(
      `${STOCKS_CACHE_PREFIX}${stockCode}:core`,
      () => this.loadCore(stockCode),
    );
  }

  /** `GET /stocks/:code/announcements` — newest `filedAt` first, class-2 page cache. */
  async getAnnouncements(
    stockCode: string,
    offset: number,
    limit: number,
    categories: readonly AnnouncementCategory[] = [],
  ): Promise<AnnouncementsPage> {
    return this.readCache.remember(
      `${STOCKS_CACHE_PREFIX}${stockCode}:announcements:${normaliseEnumKey(categories)}:${offset}:${limit}`,
      () => this.loadAnnouncements(stockCode, offset, limit, categories),
    );
  }

  /** `GET /stocks/:code/corporate-actions` — chronological `exDate`, class-2 page cache. */
  async getCorporateActions(
    stockCode: string,
    offset: number,
    limit: number,
    types: readonly CorporateActionType[] = [],
  ): Promise<CorporateActionsPage> {
    return this.readCache.remember(
      `${STOCKS_CACHE_PREFIX}${stockCode}:corporate-actions:${normaliseEnumKey(types)}:${offset}:${limit}`,
      () => this.loadCorporateActions(stockCode, offset, limit, types),
    );
  }

  /**
   * Compose the core snapshot from Postgres. Only an unknown `stockCode`
   * 404s — a known instrument with no snapshot rows serves identity with the
   * fundamentals/technicals blocks null.
   */
  private async loadCore(stockCode: string): Promise<StockCorePayload> {
    const instrument = await this.dataSource
      .getRepository(Instrument)
      .findOne({
        where: { stockCode },
        relations: { company: { sector: true }, ingestionRun: true },
      });
    if (!instrument) {
      throw new NotFoundException(`No stock found for stockCode=${stockCode}`);
    }

    const [fundamentals, indicator, shariah, bars] = await Promise.all([
      // One snapshot per company/instrument (unique FK) — findOne is the latest.
      this.dataSource.getRepository(FundamentalsSnapshot).findOne({
        where: { companyId: instrument.companyId },
        relations: { ingestionRun: true },
      }),
      this.dataSource.getRepository(IndicatorSnapshot).findOne({
        where: { instrumentId: instrument.id },
        relations: { ingestionRun: true },
      }),
      this.dataSource.getRepository(ShariahStatus).findOne({
        where: { companyId: instrument.companyId },
        order: { effectiveDate: 'DESC' },
        relations: { ingestionRun: true },
      }),
      // The two latest EOD bars for the read-time %change.
      this.dataSource.getRepository(PriceBar).find({
        where: { instrumentId: instrument.id },
        order: { tradeDate: 'DESC' },
        take: 2,
      }),
    ]);

    const identity: IdentityBlock = {
      provenance: instrument.ingestionRun.provenanceClass,
      stockCode: instrument.stockCode,
      shortName: instrument.shortName,
      fullName: instrument.fullName,
      companyName: instrument.company.fullName,
      board: instrument.company.board,
      sector: instrument.company.sector.name,
    };

    const fundamentalsBlock: FundamentalsBlock | null = fundamentals
      ? {
          provenance: fundamentals.ingestionRun.provenanceClass,
          peRatio: toNumber(fundamentals.peRatio),
          dividendYield: toNumber(fundamentals.dividendYield),
          pntaRatio: toNumber(fundamentals.pntaRatio),
          roe: toNumber(fundamentals.roe),
          debtToEquity: toNumber(fundamentals.debtToEquity),
          psr: toNumber(fundamentals.psr),
          ttmEps: Number(fundamentals.ttmEps),
          ttmRevenue: Number(fundamentals.ttmRevenue),
          ttmNetProfit: Number(fundamentals.ttmNetProfit),
          ntaPerShare: Number(fundamentals.ntaPerShare),
          // bigint column (string) — Number is safe at demo scale.
          sharesOutstanding: Number(fundamentals.sharesOutstanding),
          consecutiveGrowthQuarters: fundamentals.consecutiveGrowthQuarters,
          // The only read-time derivation; a stored null P/E stays null.
          lossMaking: Number(fundamentals.ttmEps) <= 0,
        }
      : null;

    // %change needs TWO bars: one bar (or none) → null, latestClose from the
    // snapshot either way.
    const latestClose = bars[0] ? Number(bars[0].close) : null;
    const prevClose = bars[1] ? Number(bars[1].close) : null;
    const change =
      latestClose !== null && prevClose !== null
        ? pctChange(latestClose, prevClose)
        : null;

    const technicalsBlock: TechnicalsBlock | null = indicator
      ? {
          provenance: indicator.ingestionRun.provenanceClass,
          sma20: toNumber(indicator.sma20),
          sma50: toNumber(indicator.sma50),
          sma200: toNumber(indicator.sma200),
          rsi14: toNumber(indicator.rsi14),
          macd: toNumber(indicator.macd),
          macdSignal: toNumber(indicator.macdSignal),
          week52High: toNumber(indicator.week52High),
          week52Low: toNumber(indicator.week52Low),
          latestClose: Number(indicator.latestClose),
          pctChange: change,
        }
      : null;

    // No shariah row → status/effectiveDate null, provenance still `real`
    // (the data class is real public reference data; only the row is absent).
    const shariahBlock: ShariahBlock = shariah
      ? {
          provenance: shariah.ingestionRun.provenanceClass,
          status: shariah.status,
          effectiveDate: shariah.effectiveDate,
        }
      : {
          provenance: ProvenanceClass.Real,
          status: null,
          effectiveDate: null,
        };

    return {
      identity,
      fundamentals: fundamentalsBlock,
      technicals: technicalsBlock,
      shariah: shariahBlock,
    };
  }

  private async loadAnnouncements(
    stockCode: string,
    offset: number,
    limit: number,
    categories: readonly AnnouncementCategory[],
  ): Promise<AnnouncementsPage> {
    const instrument = await this.requireInstrument(stockCode);
    const [rows, total] = await this.dataSource
      .getRepository(Announcement)
      .findAndCount({
        where: {
          companyId: instrument.companyId,
          // One-or-more category filter (spec 04 §1); flat rows carry the
          // category field — no server-side grouped payload.
          ...(categories.length > 0 ? { category: In(categories) } : {}),
        },
        relations: { ingestionRun: true },
        // id as the deterministic tiebreaker — equal filedAt rows must not
        // shuffle across pages.
        order: { filedAt: 'DESC', id: 'DESC' },
        skip: offset,
        take: limit,
      });

    const items: AnnouncementItem[] = rows.map((a) => ({
      provenance: a.ingestionRun.provenanceClass,
      category: a.category,
      title: a.title,
      // ISO string so the cached (JSON-round-tripped) and fresh shapes match.
      filedAt: a.filedAt.toISOString(),
      sourceUrl: a.sourceUrl,
      aiSummary: a.aiSummary,
      aiSummaryAsOf: a.aiSummaryAsOf === null ? null : a.aiSummaryAsOf.toISOString(),
    }));
    return { items, total, offset, limit };
  }

  private async loadCorporateActions(
    stockCode: string,
    offset: number,
    limit: number,
    types: readonly CorporateActionType[],
  ): Promise<CorporateActionsPage> {
    const instrument = await this.requireInstrument(stockCode);
    const [rows, total] = await this.dataSource
      .getRepository(CorporateAction)
      .findAndCount({
        where: {
          companyId: instrument.companyId,
          ...(types.length > 0 ? { type: In(types) } : {}),
        },
        relations: { ingestionRun: true },
        order: { exDate: 'ASC', id: 'ASC' },
        skip: offset,
        take: limit,
      });

    const items: CorporateActionItem[] = rows.map((c) => ({
      provenance: c.ingestionRun.provenanceClass,
      type: c.type,
      exDate: c.exDate,
      amount: toNumber(c.amount),
    }));
    return { items, total, offset, limit };
  }

  /** Resolve the instrument by its unique natural key or 404 (uncached — thrown through the loader). */
  private async requireInstrument(stockCode: string): Promise<Instrument> {
    const instrument = await this.dataSource
      .getRepository(Instrument)
      .findOne({ where: { stockCode } });
    if (!instrument) {
      throw new NotFoundException(`No stock found for stockCode=${stockCode}`);
    }
    return instrument;
  }
}

/**
 * Deterministic cache-key fragment for an enum filter: order-insensitive
 * (sorted) so `?category=A,B` and `?category=B,A` share one entry; empty when
 * unfiltered.
 */
function normaliseEnumKey<T extends string>(values: readonly T[]): string {
  return [...values].sort().join(',');
}
