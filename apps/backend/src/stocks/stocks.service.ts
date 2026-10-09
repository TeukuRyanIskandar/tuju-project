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

import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { DataSource, In, MoreThanOrEqual } from 'typeorm';
import { ReadCacheService, STOCKS_CACHE_PREFIX } from '../cache';
import { Announcement } from '../data/entities/announcement.entity';
import { CorporateAction } from '../data/entities/corporate-action.entity';
import { FundamentalsSnapshot } from '../data/entities/fundamentals-snapshot.entity';
import { FundamentalAnalysis } from '../data/entities/fundamental-analysis.entity';
import { IndicatorSnapshot } from '../data/entities/indicator-snapshot.entity';
import { Instrument } from '../data/entities/instrument.entity';
import { PriceBar } from '../data/entities/price-bar.entity';
import { ShariahStatus } from '../data/entities/shariah-status.entity';
import { TechnicalAnalysis } from '../data/entities/technical-analysis.entity';
import {
  AnnouncementCategory,
  CorporateActionType,
  ProvenanceClass,
} from '../data/entities/enums';
import { isKlci30 } from '../ingestion/klci30-universe';
import { seriesSinceDate } from '../market/index-params';
import { S3_CLIENT } from '../s3/s3.module';
import { pctChange, toNumber } from './serialisation';
import {
  isStockSeriesQuery,
  omitArtifactCost,
  pendingFundamentalAnalysis,
  pendingTechnicalAnalysis,
  STOCK_SERIES_RANGE_DAYS,
  toFundamentalAnalysisResponse,
  toTechnicalAnalysisResponse,
} from './stock-analysis-read';
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

@Injectable()
export class StocksService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly readCache: ReadCacheService,
    @Inject(S3_CLIENT) private readonly s3: S3Client,
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

  /** `GET /stocks/:code/analysis/technical` — thin envelope; pending when no row. */
  async getTechnicalAnalysis(
    stockCode: string,
  ): Promise<StockTechnicalAnalysisResponse> {
    const instrument = await this.requireKlciInstrument(stockCode);
    const row = await this.dataSource
      .getRepository(TechnicalAnalysis)
      .findOne({ where: { instrumentId: instrument.id } });
    if (!row) return pendingTechnicalAnalysis(stockCode);
    const latestEod = await this.latestEodCloseDay(instrument.id);
    return toTechnicalAnalysisResponse(stockCode, row, latestEod);
  }

  /** `GET /stocks/:code/analysis/fundamental` — thin envelope; pending when no row. */
  async getFundamentalAnalysis(
    stockCode: string,
  ): Promise<StockFundamentalAnalysisResponse> {
    const instrument = await this.requireKlciInstrument(stockCode);
    const row = await this.dataSource
      .getRepository(FundamentalAnalysis)
      .findOne({ where: { instrumentId: instrument.id } });
    if (!row) return pendingFundamentalAnalysis(stockCode);
    const latestEod = await this.latestEodCloseDay(instrument.id);
    return toFundamentalAnalysisResponse(stockCode, row, latestEod);
  }

  /** Proxied TA artifact JSON with `cost` stripped (ADR-0014). */
  async getTechnicalArtifact(
    stockCode: string,
  ): Promise<Record<string, unknown>> {
    const instrument = await this.requireKlciInstrument(stockCode);
    const row = await this.dataSource
      .getRepository(TechnicalAnalysis)
      .findOne({ where: { instrumentId: instrument.id } });
    return this.loadArtifact(stockCode, row);
  }

  /** Proxied FA artifact JSON with `cost` stripped (ADR-0014). */
  async getFundamentalArtifact(
    stockCode: string,
  ): Promise<Record<string, unknown>> {
    const instrument = await this.requireKlciInstrument(stockCode);
    const row = await this.dataSource
      .getRepository(FundamentalAnalysis)
      .findOne({ where: { instrumentId: instrument.id } });
    return this.loadArtifact(stockCode, row);
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

  /** PoC series/analysis hard-gate: outside KLCI 30 or unknown → 404. */
  private async requireKlciInstrument(stockCode: string): Promise<Instrument> {
    if (!isKlci30(stockCode)) {
      throw new NotFoundException(`No stock found for stockCode=${stockCode}`);
    }
    return this.requireInstrument(stockCode);
  }

  private async loadSeries(stockCode: string): Promise<StockSeriesResponse> {
    const instrument = await this.dataSource
      .getRepository(Instrument)
      .findOne({
        where: { stockCode },
        relations: { ingestionRun: true },
      });
    if (!instrument || !isKlci30(stockCode)) {
      throw new NotFoundException(`No stock found for stockCode=${stockCode}`);
    }

    const latest = await this.dataSource.getRepository(PriceBar).findOne({
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
    const bars = await this.dataSource.getRepository(PriceBar).find({
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

  private async latestEodCloseDay(instrumentId: string): Promise<string | null> {
    const latest = await this.dataSource.getRepository(PriceBar).findOne({
      where: { instrumentId },
      order: { tradeDate: 'DESC' },
    });
    return latest?.tradeDate ?? null;
  }

  private async loadArtifact(
    stockCode: string,
    row:
      | Pick<
          TechnicalAnalysis,
          'artifactBucket' | 'artifactKey'
        >
      | Pick<
          FundamentalAnalysis,
          'artifactBucket' | 'artifactKey'
        >
      | null,
  ): Promise<Record<string, unknown>> {
    if (!row?.artifactBucket || !row.artifactKey) {
      throw new NotFoundException(
        `No analysis artifact for stockCode=${stockCode}`,
      );
    }
    const out = await this.s3.send(
      new GetObjectCommand({
        Bucket: row.artifactBucket,
        Key: row.artifactKey,
      }),
    );
    const body = await out.Body?.transformToString('utf-8');
    if (!body) {
      throw new NotFoundException(
        `Analysis artifact body is empty for stockCode=${stockCode}`,
      );
    }
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return omitArtifactCost(parsed);
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
