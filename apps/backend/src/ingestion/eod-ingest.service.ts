/**
 * Nightly EOD + indicator ingest (spec 01 cadences; ticket 04).
 *
 * The join point of the whole ticket: it reads the source-adapter seam (never
 * knowing the producer), opens the correct {@link IngestionRun}/{@link SyntheticRun}
 * lineage for each provenance class, persists the adapter output onto Postgres with
 * every sourced row FK'd to its run, then — **ordered strictly after** the EOD
 * price/fundamentals land — materialises per-company ratios and per-instrument
 * indicator snapshots.
 *
 * ADR-0004 sole-writer holds: this runs in the second NestJS process but is the
 * same Postgres writer. All writes are wrapped in one transaction so a failed
 * ingest leaves no half-written lineage.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import {
  DISCLOSURE_ADAPTER,
  FUNDAMENTALS_ADAPTER,
  IPO_ADAPTER,
  MARKET_DATA_ADAPTER,
  NEWS_ADAPTER,
  SHARIAH_LIST_ADAPTER,
  type DisclosureAdapter,
  type FundamentalsAdapter,
  type IpoAdapter,
  type MarketDataAdapter,
  type NewsAdapter,
  type ShariahListAdapter,
} from '../data/adapters';
import type { PriceBarDto } from '../data/adapters/dto';
import { Announcement } from '../data/entities/announcement.entity';
import { CorporateAction } from '../data/entities/corporate-action.entity';
import { FundamentalsSnapshot } from '../data/entities/fundamentals-snapshot.entity';
import { IndicatorSnapshot } from '../data/entities/indicator-snapshot.entity';
import { IpoListing } from '../data/entities/ipo-listing.entity';
import { NewsArticle } from '../data/entities/news-article.entity';
import { PriceBar } from '../data/entities/price-bar.entity';
import { QuarterlyFinancials } from '../data/entities/quarterly-financials.entity';
import { ShariahStatus } from '../data/entities/shariah-status.entity';
import { IngestionRunService } from './ingestion-run.service';
import { ReferenceDataService } from './reference-data.service';
import { materialiseSnapshot } from './fundamentals-materialiser';
import { computeIndicators, WEEK52_WINDOW } from './indicators';
import { SYNTHETIC_BASE_SEED, instrumentSeed } from './reference-universe';
import { DEFAULT_PARAMS } from '../data/synthetic';

/** Summary of what a nightly ingest landed (returned for tests / logging). */
export interface NightlyIngestResult {
  priceBars: number;
  quarterlyRows: number;
  fundamentalsSnapshots: number;
  indicatorSnapshots: number;
  announcements: number;
  corporateActions: number;
  newsArticles: number;
  shariahStatuses: number;
  ipoListings: number;
}

@Injectable()
export class EodIngestService {
  private readonly logger = new Logger(EodIngestService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly runs: IngestionRunService,
    private readonly reference: ReferenceDataService,
    @Inject(MARKET_DATA_ADAPTER) private readonly market: MarketDataAdapter,
    @Inject(FUNDAMENTALS_ADAPTER) private readonly fundamentals: FundamentalsAdapter,
    @Inject(DISCLOSURE_ADAPTER) private readonly disclosure: DisclosureAdapter,
    @Inject(NEWS_ADAPTER) private readonly news: NewsAdapter,
    @Inject(SHARIAH_LIST_ADAPTER) private readonly shariah: ShariahListAdapter,
    @Inject(IPO_ADAPTER) private readonly ipo: IpoAdapter,
  ) {}

  /**
   * Run one nightly ingest end-to-end inside a single transaction.
   * Order: reference → EOD prices + fundamentals → disclosures/news/shariah/ipo →
   * (ordered after) ratio materialisation → indicator snapshots.
   */
  async runNightly(): Promise<NightlyIngestResult> {
    return this.dataSource.transaction(async (manager) => {
      const ref = await this.reference.ensureReferenceData(manager);

      // --- Synthetic price + fundamentals lineage (one SyntheticRun) ---
      const syntheticRun = await this.runs.openSyntheticRun(
        manager,
        'SyntheticMarketDataAdapter',
        SYNTHETIC_BASE_SEED,
        { ...DEFAULT_PARAMS, baseSeed: SYNTHETIC_BASE_SEED },
      );

      const bars = await this.market.fetchDailyBars();
      const priceBars = await this.persistPriceBars(
        manager,
        bars,
        ref.instrumentByStockCode,
        syntheticRun.id,
      );

      const fundamentals = await this.fundamentals.fetchFundamentals();
      const quarterlyRows = await this.persistQuarterly(
        manager,
        fundamentals,
        ref.companyByStockCode,
        syntheticRun.id,
      );

      // --- Aggregator disclosures + news (one aggregator run each) ---
      const disclosureRun = await this.runs.openRun(
        manager,
        'AggregatorDisclosureAdapter',
        this.disclosure.provenanceClass,
      );
      const announcementsDto = await this.disclosure.fetchAnnouncements();
      const announcements = await this.persistAnnouncements(
        manager,
        announcementsDto,
        ref.companyByStockCode,
        disclosureRun.id,
      );
      const corporateActionsDto = await this.disclosure.fetchCorporateActions();
      const corporateActions = await this.persistCorporateActions(
        manager,
        corporateActionsDto,
        ref.companyByStockCode,
        disclosureRun.id,
      );

      const newsRun = await this.runs.openRun(
        manager,
        'RssNewsAdapter',
        this.news.provenanceClass,
      );
      const headlines = await this.news.fetchHeadlines();
      const newsArticles = await this.persistNews(manager, headlines, newsRun.id);

      // --- Manual reference (real) Shariah + IPO ---
      const shariahRun = await this.runs.openRun(
        manager,
        'ManualShariahListAdapter',
        this.shariah.provenanceClass,
      );
      const shariahDto = await this.shariah.fetchShariahStatuses();
      const shariahStatuses = await this.persistShariah(
        manager,
        shariahDto,
        ref.companyByStockCode,
        shariahRun.id,
      );

      const ipoRun = await this.runs.openRun(
        manager,
        'ManualIpoAdapter',
        this.ipo.provenanceClass,
      );
      const ipoDto = await this.ipo.fetchIpoListings();
      const ipoListings = await this.persistIpos(manager, ipoDto, ipoRun.id);

      // --- Ordered AFTER EOD: ratio materialisation + indicator snapshots ---
      const barsByStockCode = groupBy(bars, (b) => b.stockCode);
      const dividendsByStockCode = groupBy(
        corporateActionsDto,
        (a) => a.stockCode,
      );

      let fundamentalsSnapshots = 0;
      for (const fund of fundamentals) {
        const companyId = ref.companyByStockCode.get(fund.stockCode);
        const companyBars = barsByStockCode.get(fund.stockCode) ?? [];
        if (!companyId || companyBars.length === 0) continue;
        const dividends = (dividendsByStockCode.get(fund.stockCode) ?? []).map(
          (a) => ({ exDate: a.exDate, amount: a.amount }),
        );
        const snap = materialiseSnapshot(fund, companyBars, dividends);
        await manager.getRepository(FundamentalsSnapshot).save(
          manager.getRepository(FundamentalsSnapshot).create({
            companyId,
            ...snap,
            ingestionRunId: syntheticRun.id,
          }),
        );
        fundamentalsSnapshots++;
      }

      const indicatorSnapshots = await this.materialiseIndicators(
        manager,
        ref.instrumentByStockCode,
        syntheticRun.id,
      );

      const result: NightlyIngestResult = {
        priceBars,
        quarterlyRows,
        fundamentalsSnapshots,
        indicatorSnapshots,
        announcements,
        corporateActions,
        newsArticles,
        shariahStatuses,
        ipoListings,
      };
      // ADR-0010: every log line carries a correlationId.  The nightly ingest is
      // not a JobBus job so there is no envelope id; the SyntheticRun id is the
      // per-run stitch key that ties every persisted row back to this ingest.
      this.logger.log(
        { correlationId: syntheticRun.id, msg: 'nightly-eod-ingest.complete', ...result },
        'nightly-eod-ingest.complete',
      );
      return result;
    });
  }

  private async persistPriceBars(
    manager: EntityManager,
    bars: PriceBarDto[],
    instrumentByStockCode: Map<string, string>,
    runId: string,
  ): Promise<number> {
    const repo = manager.getRepository(PriceBar);
    const rows = bars
      .map((b) => {
        const instrumentId = instrumentByStockCode.get(b.stockCode);
        if (!instrumentId) return null;
        return repo.create({
          instrumentId,
          tradeDate: b.tradeDate,
          open: b.open.toFixed(6),
          high: b.high.toFixed(6),
          low: b.low.toFixed(6),
          close: b.close.toFixed(6),
          volume: Math.trunc(b.volume).toString(),
          ingestionRunId: runId,
        });
      })
      .filter((r): r is PriceBar => r !== null);
    await repo.save(rows, { chunk: 500 });
    return rows.length;
  }

  private async persistQuarterly(
    manager: EntityManager,
    fundamentals: Awaited<ReturnType<FundamentalsAdapter['fetchFundamentals']>>,
    companyByStockCode: Map<string, string>,
    runId: string,
  ): Promise<number> {
    const repo = manager.getRepository(QuarterlyFinancials);
    const rows: QuarterlyFinancials[] = [];
    for (const fund of fundamentals) {
      const companyId = companyByStockCode.get(fund.stockCode);
      if (!companyId) continue;
      for (const q of fund.quarters) {
        rows.push(
          repo.create({
            companyId,
            fiscalYear: q.fiscalYear,
            fiscalQuarter: q.fiscalQuarter,
            periodEnd: q.periodEnd,
            revenue: q.revenue.toFixed(2),
            netProfit: q.netProfit.toFixed(2),
            eps: q.eps.toFixed(6),
            equity: q.equity.toFixed(2),
            nta: q.nta.toFixed(2),
            intangibles: q.intangibles.toFixed(2),
            totalBorrowings: q.totalBorrowings.toFixed(2),
            ingestionRunId: runId,
          }),
        );
      }
    }
    await repo.save(rows, { chunk: 500 });
    return rows.length;
  }

  private async persistAnnouncements(
    manager: EntityManager,
    dtos: Awaited<ReturnType<DisclosureAdapter['fetchAnnouncements']>>,
    companyByStockCode: Map<string, string>,
    runId: string,
  ): Promise<number> {
    const repo = manager.getRepository(Announcement);
    const rows = dtos
      .map((d) => {
        const companyId = companyByStockCode.get(d.stockCode);
        if (!companyId) return null;
        return repo.create({
          companyId,
          category: d.category,
          title: d.title,
          filedAt: d.filedAt,
          sourceUrl: d.sourceUrl,
          ingestionRunId: runId,
        });
      })
      .filter((r): r is Announcement => r !== null);
    await repo.save(rows);
    return rows.length;
  }

  private async persistCorporateActions(
    manager: EntityManager,
    dtos: Awaited<ReturnType<DisclosureAdapter['fetchCorporateActions']>>,
    companyByStockCode: Map<string, string>,
    runId: string,
  ): Promise<number> {
    const repo = manager.getRepository(CorporateAction);
    const rows = dtos
      .map((d) => {
        const companyId = companyByStockCode.get(d.stockCode);
        if (!companyId) return null;
        return repo.create({
          companyId,
          type: d.type,
          exDate: d.exDate,
          amount: d.amount === null ? null : d.amount.toFixed(6),
          ingestionRunId: runId,
        });
      })
      .filter((r): r is CorporateAction => r !== null);
    await repo.save(rows);
    return rows.length;
  }

  private async persistNews(
    manager: EntityManager,
    dtos: Awaited<ReturnType<NewsAdapter['fetchHeadlines']>>,
    runId: string,
  ): Promise<number> {
    const repo = manager.getRepository(NewsArticle);
    const rows = dtos.map((d) =>
      repo.create({
        headline: d.headline,
        url: d.url,
        source: d.source,
        publishedAt: d.publishedAt,
        ingestionRunId: runId,
      }),
    );
    await repo.save(rows);
    return rows.length;
  }

  private async persistShariah(
    manager: EntityManager,
    dtos: Awaited<ReturnType<ShariahListAdapter['fetchShariahStatuses']>>,
    companyByStockCode: Map<string, string>,
    runId: string,
  ): Promise<number> {
    const repo = manager.getRepository(ShariahStatus);
    const rows = dtos
      .map((d) => {
        const companyId = companyByStockCode.get(d.stockCode);
        if (!companyId) return null;
        return repo.create({
          companyId,
          status: d.status,
          effectiveDate: d.effectiveDate,
          ingestionRunId: runId,
        });
      })
      .filter((r): r is ShariahStatus => r !== null);
    await repo.save(rows);
    return rows.length;
  }

  private async persistIpos(
    manager: EntityManager,
    dtos: Awaited<ReturnType<IpoAdapter['fetchIpoListings']>>,
    runId: string,
  ): Promise<number> {
    const repo = manager.getRepository(IpoListing);
    const rows = dtos.map((d) =>
      repo.create({
        companyName: d.companyName,
        board: d.board,
        listingDate: d.listingDate,
        offerPrice: d.offerPrice === null ? null : d.offerPrice.toFixed(6),
        prospectusS3Key: d.prospectusS3Key,
        ingestionRunId: runId,
      }),
    );
    await repo.save(rows);
    return rows.length;
  }

  /**
   * Materialise one latest {@link IndicatorSnapshot} per instrument from the
   * persisted price bars. SMA/RSI/MACD are computed in TS (`trading-signals`); the
   * 52-week high/low is a SQL window over the last {@link WEEK52_WINDOW} trading
   * days (proving the SQL-window path, not just the in-memory fallback).
   */
  private async materialiseIndicators(
    manager: EntityManager,
    instrumentByStockCode: Map<string, string>,
    runId: string,
  ): Promise<number> {
    const snapshotRepo = manager.getRepository(IndicatorSnapshot);
    const barRepo = manager.getRepository(PriceBar);
    let count = 0;

    for (const instrumentId of instrumentByStockCode.values()) {
      const bars = await barRepo.find({
        where: { instrumentId },
        order: { tradeDate: 'ASC' },
      });
      if (bars.length === 0) continue;

      const closes = bars.map((b) => Number(b.close));
      const indicators = computeIndicators(closes);

      // 52-week hi/lo via a SQL window over the last 252 trading days.
      const window = await manager.query(
        `SELECT MAX(close) AS high, MIN(close) AS low
           FROM (
             SELECT close FROM price_bars
             WHERE instrument_id = $1
             ORDER BY trade_date DESC
             LIMIT $2
           ) recent`,
        [instrumentId, WEEK52_WINDOW],
      );
      const week52High: string | null = window[0]?.high ?? null;
      const week52Low: string | null = window[0]?.low ?? null;

      await snapshotRepo.save(
        snapshotRepo.create({
          instrumentId,
          latestClose: indicators.latestClose,
          sma20: indicators.sma20,
          sma50: indicators.sma50,
          sma200: indicators.sma200,
          rsi14: indicators.rsi14,
          macd: indicators.macd,
          macdSignal: indicators.macdSignal,
          week52High: week52High !== null ? Number(week52High).toFixed(6) : indicators.week52High,
          week52Low: week52Low !== null ? Number(week52Low).toFixed(6) : indicators.week52Low,
          ingestionRunId: runId,
        }),
      );
      count++;
    }
    return count;
  }
}

/** Group array items by a string key. */
function groupBy<T>(items: readonly T[], key: (t: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const arr = map.get(k);
    if (arr) arr.push(item);
    else map.set(k, [item]);
  }
  return map;
}
