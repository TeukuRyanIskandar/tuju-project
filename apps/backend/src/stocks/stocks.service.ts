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
 * Caching is class-2 read-through (ADR-0004) via `ReadModelCache`, one named
 * read per code (+ page on the lists). A `NotFoundException` for an unknown
 * code is thrown THROUGH the loader — `read` propagates exceptions uncached —
 * so a 404 never poisons a key and the hot path needs no pre-flight existence
 * query. Invalidation is NOT wired here: writers announce their changes
 * (ingest, purge, announcement summaries) and the cache module decides.
 */

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import { ReadModelCache, ReadModelReads } from '../cache';
import { Announcement } from '../data/entities/announcement.entity';
import { CorporateAction } from '../data/entities/corporate-action.entity';
import { FundamentalsSnapshot } from '../data/entities/fundamentals-snapshot.entity';
import { IndicatorSnapshot } from '../data/entities/indicator-snapshot.entity';
import { Instrument } from '../data/entities/instrument.entity';
import { PriceBar } from '../data/entities/price-bar.entity';
import { QuarterlyFinancials } from '../data/entities/quarterly-financials.entity';
import { ShariahStatus } from '../data/entities/shariah-status.entity';
import {
  AnnouncementCategory,
  CorporateActionType,
  ProvenanceClass,
} from '../data/entities/enums';
import { isKlci30 } from '../ingestion/klci30-universe';
import { seriesSinceDate } from '../market/index-params';
import { StockAnalysis } from '../analysis/stock-analysis';
import { pctChange, toNumber } from './serialisation';
import { isStockSeriesQuery, STOCK_SERIES_RANGE_DAYS } from './series-query';
import { computeTechnicalEvents } from './technical-events';
import { toAnalysisReference } from './analysis-reference';
import type {
  AnnouncementsPage,
  AnnouncementItem,
  CorporateActionItem,
  CorporateActionsPage,
  FundamentalsBlock,
  IdentityBlock,
  ShariahBlock,
  StockCorePayload,
  StockFundamentalAnalysisResponse,
  StockSeriesPoint,
  StockSeriesResponse,
  StockTechnicalAnalysisResponse,
  TechnicalsBlock,
} from './stocks.types';
import type { AnalysisReferenceResponse } from './analysis-reference';

@Injectable()
export class StocksService {
  constructor(
    @InjectRepository(IndicatorSnapshot)
    private readonly indicatorSnapshotRepo: Repository<IndicatorSnapshot>,
    @InjectRepository(FundamentalsSnapshot)
    private readonly fundamentalsSnapshotRepo: Repository<FundamentalsSnapshot>,
    @InjectRepository(QuarterlyFinancials)
    private readonly quarterlyFinancialsRepo: Repository<QuarterlyFinancials>,
    @InjectRepository(PriceBar)
    private readonly priceBarRepo: Repository<PriceBar>,
    @InjectRepository(Announcement)
    private readonly announcementRepo: Repository<Announcement>,
    @InjectRepository(CorporateAction)
    private readonly corporateActionRepo: Repository<CorporateAction>,
    @InjectRepository(ShariahStatus)
    private readonly shariahStatusRepo: Repository<ShariahStatus>,
    @InjectRepository(Instrument)
    private readonly instrumentRepo: Repository<Instrument>,
    private readonly readCache: ReadModelCache,
    private readonly analyses: StockAnalysis,
  ) {}

  /** `GET /stocks/:code` — the class-2-cached core snapshot. */
  async getCore(stockCode: string): Promise<StockCorePayload> {
    return this.readCache.read(ReadModelReads.stockCore(stockCode), () =>
      this.loadCore(stockCode),
    );
  }

  /** `GET /stocks/:code/announcements` — newest `filedAt` first, class-2 page cache. */
  async getAnnouncements(
    stockCode: string,
    offset: number,
    limit: number,
    categories: readonly AnnouncementCategory[] = [],
  ): Promise<AnnouncementsPage> {
    return this.readCache.read(
      ReadModelReads.stockAnnouncements(stockCode, categories, { offset, limit }),
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
    return this.readCache.read(
      ReadModelReads.stockCorporateActions(stockCode, types, { offset, limit }),
      () => this.loadCorporateActions(stockCode, offset, limit, types),
    );
  }

  /** `GET /stocks/:code/series?interval=1d&range=2y` — KLCI-30 hard-gated. */
  async getSeries(
    stockCode: string,
    interval?: string,
    range?: string,
  ): Promise<StockSeriesResponse> {
    if (!isStockSeriesQuery(interval, range)) {
      throw new BadRequestException(
        'Only interval=1d and range=2y are supported',
      );
    }
    return this.loadSeries(stockCode);
  }

  /**
   * `GET /stocks/:code/analysis/technical` — thin envelope; pending when no
   * row, `stale` promoted at read time. Owned (and cached) by `StockAnalysis`.
   */
  async getTechnicalAnalysis(
    stockCode: string,
  ): Promise<StockTechnicalAnalysisResponse> {
    return this.analyses.status(stockCode, 'technical');
  }

  /** `GET /stocks/:code/analysis/fundamental` — thin envelope (see above). */
  async getFundamentalAnalysis(
    stockCode: string,
  ): Promise<StockFundamentalAnalysisResponse> {
    return this.analyses.status(stockCode, 'fundamental');
  }

  /** Proxied TA artifact JSON with `cost` stripped (ADR-0014). */
  async getTechnicalArtifact(
    stockCode: string,
  ): Promise<Record<string, unknown>> {
    return this.analyses.artifact(stockCode, 'technical');
  }

  /** Proxied FA artifact JSON with `cost` stripped (ADR-0014). */
  async getFundamentalArtifact(
    stockCode: string,
  ): Promise<Record<string, unknown>> {
    return this.analyses.artifact(stockCode, 'fundamental');
  }

  /**
   * Worker-facing reference endpoint: all facts (TA indicators + events, FA metrics)
   * without the AI narrative. No caching — worker needs live data.
   */
  async getAnalysisReference(
    stockCode: string,
  ): Promise<AnalysisReferenceResponse> {
    const instrument = await this.requireKlciInstrument(stockCode);

    const snap = await this.indicatorSnapshotRepo.findOne({
      where: { instrumentId: instrument.id },
    });
    if (!snap) {
      throw new NotFoundException(
        `No indicator snapshot for stockCode=${stockCode}`,
      );
    }

    const [fundSnap, quarters, bars] = await Promise.all([
      this.fundamentalsSnapshotRepo.findOne({
        where: { companyId: instrument.companyId },
        relations: { ingestionRun: true },
      }),
      this.quarterlyFinancialsRepo.find({
        where: { companyId: instrument.companyId },
        order: { periodEnd: 'DESC' },
        take: 2,
      }),
      this.priceBarRepo.find({
        where: { instrumentId: instrument.id },
        order: { tradeDate: 'DESC' },
        take: 2,
      }),
    ]);

    const latestCloseDay = bars.length > 0 ? bars[0].tradeDate : null;
    const prevBar = bars.length > 1 ? bars[1] : null;

    if (!latestCloseDay) {
      throw new NotFoundException(
        `No price bars for stockCode=${stockCode}`,
      );
    }

    const technicalEvents = computeTechnicalEvents(snap, latestCloseDay, prevBar);

    const now = new Date();
    const asOfDatetime = now.toISOString();

    return toAnalysisReference(
      instrument,
      snap,
      fundSnap ?? null,
      quarters,
      technicalEvents,
      latestCloseDay,
      asOfDatetime,
    );
  }


  /**
   * Compose the core snapshot from Postgres. Only an unknown `stockCode`
   * 404s — a known instrument with no snapshot rows serves identity with the
   * fundamentals/technicals blocks null.
   */
  private async loadCore(stockCode: string): Promise<StockCorePayload> {
    const instrument = await this.instrumentRepo.findOne({
      where: { stockCode },
      relations: { company: { sector: true }, ingestionRun: true },
    });
    if (!instrument) {
      throw new NotFoundException(`No stock found for stockCode=${stockCode}`);
    }

    const [fundamentals, indicator, shariah, bars] = await Promise.all([
      this.fundamentalsSnapshotRepo.findOne({
        where: { companyId: instrument.companyId },
        relations: { ingestionRun: true },
      }),
      this.indicatorSnapshotRepo.findOne({
        where: { instrumentId: instrument.id },
        relations: { ingestionRun: true },
      }),
      this.shariahStatusRepo.findOne({
        where: { companyId: instrument.companyId },
        order: { effectiveDate: 'DESC' },
        relations: { ingestionRun: true },
      }),
      this.priceBarRepo.find({
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
    const [rows, total] = await this.announcementRepo.findAndCount({
      where: {
        companyId: instrument.companyId,
        ...(categories.length > 0 ? { category: In(categories) } : {}),
      },
      relations: { ingestionRun: true },
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
    const [rows, total] = await this.corporateActionRepo.findAndCount({
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
    const instrument = await this.instrumentRepo.findOne({
      where: { stockCode },
    });
    if (!instrument) {
      throw new NotFoundException(`No stock found for stockCode=${stockCode}`);
    }
    return instrument;
  }

  /** PoC series/analysis hard-gate: outside KLCI 30 or unknown → 404. */
  private async requireKlciInstrument(stockCode: string): Promise<Instrument> {
    if (!isKlci30(stockCode)) {
      throw new NotFoundException(`No stock found for stockCode=${stockCode}`);
    }
    return this.requireInstrument(stockCode);
  }

  private async loadSeries(stockCode: string): Promise<StockSeriesResponse> {
    const instrument = await this.instrumentRepo.findOne({
      where: { stockCode },
      relations: { ingestionRun: true },
    });
    if (!instrument || !isKlci30(stockCode)) {
      throw new NotFoundException(`No stock found for stockCode=${stockCode}`);
    }

    const latest = await this.priceBarRepo.findOne({
      where: { instrumentId: instrument.id },
      order: { tradeDate: 'DESC' },
      relations: { ingestionRun: true },
    });

    if (!latest) {
      return {
        code: stockCode,
        interval: '1d',
        range: '2y',
        points: [],
        provenance: instrument.ingestionRun.provenanceClass,
        demoLabel: 'private-demo',
      };
    }

    const since = seriesSinceDate(latest.tradeDate, STOCK_SERIES_RANGE_DAYS);
    const bars = await this.priceBarRepo.find({
      where: {
        instrumentId: instrument.id,
        ...(since ? { tradeDate: MoreThanOrEqual(since) } : {}),
      },
      order: { tradeDate: 'ASC' },
      relations: { ingestionRun: true },
    });

    const points: StockSeriesPoint[] = bars.map((b) => ({
      date: b.tradeDate,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }));

    return {
      code: stockCode,
      interval: '1d',
      range: '2y',
      points,
      provenance: latest.ingestionRun.provenanceClass,
      demoLabel: 'private-demo',
    };
  }
}
