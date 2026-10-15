/**
 * Nightly EOD + indicator ingest (spec 01 cadences; ticket 04).
 *
 * The join point of the whole ticket: it reads the source-adapter seam (never
 * knowing the producer), lands each adapter's output through the Ingestion run
 * module ({@link IngestionRunService.run}), which opens the run from the
 * adapter's own `adapterName` + provenance, so every sourced row is FK'd to the
 * right lineage, then — **ordered strictly after** the EOD price/fundamentals
 * land — materialises per-company ratios and per-instrument indicator snapshots.
 *
 * The nightly is an ordered list of steps with no provenance branching: what
 * varies by bound adapter is declared BY the adapter (its name, provenance,
 * seeded generation, analysed universe, failures and vendor dividends returned
 * from its fetch). Swapping an adapter needs no change here.
 *
 * ADR-0004 sole-writer holds: this runs in the second NestJS process but is the
 * same Postgres writer. All writes are wrapped in one transaction so a failed
 * ingest leaves no half-written lineage.
 *
 * Re-ingest is idempotent on natural keys (ticket 05): every persist is an
 * upsert against the table's unique natural key (the ones ticket 01 already
 * created, plus the three `ReIngestNaturalKeys` added), so a second nightly
 * against a populated DB updates rows in place — no duplicate-key failure, no
 * duplicate rows, stable row ids (FKs like news tags survive), lineage
 * re-pointed to the fresh run. `ingestion_runs` rows accumulate per nightly on
 * purpose (audit trail), which is the accepted cost of option B.
 */

import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, In, type EntityManager } from 'typeorm';
import type { AnnouncementSummaryPayload, JobEnvelope } from '@tuju/contracts';
import { JobBus } from '../jobbus/job-bus.service';
import { JobNames } from '../jobbus/job-names';
import {
  DISCLOSURE_ADAPTER,
  FUNDAMENTALS_ADAPTER,
  INDEX_ADAPTER,
  IPO_ADAPTER,
  MARKET_DATA_ADAPTER,
  NEWS_ADAPTER,
  SHARIAH_LIST_ADAPTER,
  type DisclosureAdapter,
  type FundamentalsAdapter,
  type FundamentalsFetch,
  type IndexAdapter,
  type IpoAdapter,
  type MarketDataAdapter,
  type NewsAdapter,
  type ShariahListAdapter,
} from '../data/adapters';
import type {
  AnnouncementDto,
  CorporateActionDto,
  DividendDto,
  FundamentalsDto,
  IndexLevelsDto,
  IpoListingDto,
  NewsArticleDto,
  PriceBarDto,
  ShariahStatusDto,
} from '../data/adapters/dto';
import { Announcement } from '../data/entities/announcement.entity';
import { CorporateAction } from '../data/entities/corporate-action.entity';
import { FundamentalsSnapshot } from '../data/entities/fundamentals-snapshot.entity';
import { IndexLevel } from '../data/entities/index-level.entity';
import { IndicatorSnapshot } from '../data/entities/indicator-snapshot.entity';
import { IpoListing } from '../data/entities/ipo-listing.entity';
import { MarketIndex } from '../data/entities/market-index.entity';
import { NewsArticle } from '../data/entities/news-article.entity';
import { NewsArticleTag } from '../data/entities/news-article-tag.entity';
import { Instrument } from '../data/entities/instrument.entity';
import { PriceBar } from '../data/entities/price-bar.entity';
import { QuarterlyFinancials } from '../data/entities/quarterly-financials.entity';
import { ShariahStatus } from '../data/entities/shariah-status.entity';
import { Sector } from '../data/entities/sector.entity';
import { CorporateActionType } from '../data/entities/enums';
import { IngestionRunService, type RunOutcome } from './ingestion-run.service';
import { ReferenceDataService, type ReferenceIds } from './reference-data.service';
import { KlciSeedService } from './klci-seed.service';
import { KlciEnqueueService } from './klci-enqueue.service';
import { KLCI30_UNIVERSE } from './klci30-universe';
import { materialiseSnapshot } from './fundamentals-materialiser';
import { computeIndicators, WEEK52_WINDOW } from './indicators';
import { ReadModelCache } from '../cache';
import { matchCompanyTags, type TaggableCompany } from './news-tagging';

/** Summary of what a nightly ingest landed (returned for tests / logging). */
export interface NightlyIngestResult {
  priceBars: number;
  quarterlyRows: number;
  fundamentalsSnapshots: number;
  indicatorSnapshots: number;
  announcements: number;
  corporateActions: number;
  newsArticles: number;
  /** Deterministic alias-match tags written for the ingested headlines (spec 04). */
  newsArticleTags: number;
  shariahStatuses: number;
  ipoListings: number;
  /** Reference MarketIndex rows upserted (headline + per-Sector, spec 05). */
  marketIndices: number;
  /** IndexLevel series rows upserted (one per index per day, spec 05). */
  indexLevels: number;
  /** Ops-visible per-item failures every adapter fetch reported (if any). */
  failures: string[];
}

/** Summary of a KLCI-30 pull + materialise (CLI `ingest-klci` / yfinance nightly). */
export interface KlciIngestResult {
  priceBars: number;
  quarterlyRows: number;
  fundamentalsSnapshots: number;
  indicatorSnapshots: number;
  failures: string[];
  runId: string;
}

/** What the EOD step landed, carried to the ordered-after materialise step. */
interface EodLanded {
  readonly bars: PriceBarDto[];
  readonly fundamentals: FundamentalsFetch;
  readonly priceBars: number;
  readonly quarterlyRows: number;
}

/** What the disclosure step landed; corporate actions feed DY (single source). */
interface DisclosuresLanded {
  readonly announcements: number;
  /** Not-yet-summarised announcement ids, enqueued after commit. */
  readonly announcementIdsToSummarize: string[];
  readonly corporateActions: number;
  readonly corporateActionRows: CorporateActionDto[];
}

@Injectable()
export class EodIngestService {
  private readonly logger = new Logger(EodIngestService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly runs: IngestionRunService,
    private readonly reference: ReferenceDataService,
    private readonly klciSeed: KlciSeedService,
    @Inject(MARKET_DATA_ADAPTER) private readonly market: MarketDataAdapter,
    @Inject(FUNDAMENTALS_ADAPTER) private readonly fundamentals: FundamentalsAdapter,
    @Inject(DISCLOSURE_ADAPTER) private readonly disclosure: DisclosureAdapter,
    @Inject(NEWS_ADAPTER) private readonly news: NewsAdapter,
    @Inject(SHARIAH_LIST_ADAPTER) private readonly shariah: ShariahListAdapter,
    @Inject(IPO_ADAPTER) private readonly ipo: IpoAdapter,
    @Inject(INDEX_ADAPTER) private readonly index: IndexAdapter,
    private readonly readCache: ReadModelCache,
    private readonly jobBus: JobBus,
    private readonly klciEnqueue: KlciEnqueueService,
  ) {}

  /**
   * Pull bars + fundamentals and materialise snapshots/indicators for the KLCI 30.
   * Requires `seed-klci` first. The run is opened from the bound market
   * adapter's own name + provenance (`YFinanceMarketDataAdapter`/`real` when
   * yfinance). No disclosure fetch here, so DY reads only the fundamentals
   * fetch's vendor dividends (none → DY 0).
   */
  async ingestKlci(): Promise<KlciIngestResult> {
    const result = await this.dataSource.transaction(async (manager) => {
      const ids = await this.resolveKlciReferenceIds(manager);
      const eod = await this.landEod(manager, ids);
      const materialised = await this.materialise(manager, ids, eod, []);
      const result: KlciIngestResult = {
        priceBars: eod.value.priceBars,
        quarterlyRows: eod.value.quarterlyRows,
        ...materialised,
        failures: eod.failures,
        runId: eod.runId,
      };
      this.logger.log(
        { correlationId: eod.runId, msg: 'klci-ingest.complete', ...result },
        'klci-ingest.complete',
      );
      return result;
    });
    await this.readCache.changed({ kind: 'eodIngested' });
    return result;
  }

  /**
   * Run one nightly ingest end-to-end inside a single transaction, as ordered
   * steps: reference → the market adapter's analysed universe → EOD prices +
   * fundamentals (one run) → disclosures / news / Shariah / IPO (one run each)
   * → (ordered after) ratio + indicator materialisation → index levels. Then,
   * after commit: one cache invalidation, the announcement-summary enqueue, and
   * the universe's follow-on (TA/FA fan-out for the KLCI 30).
   */
  async runNightly(): Promise<NightlyIngestResult> {
    // Escapes the transaction closure below so the showcase enqueue (spec 06,
    // ticket 03) runs AFTER commit — the worker fetches the announcement via
    // NestJS's own read API, which must see committed data.
    let announcementIdsToSummarize: string[] = [];

    const result = await this.dataSource.transaction(async (manager) => {
      const ref = await this.reference.ensureReferenceData(manager);
      const universe = await this.ensureMarketUniverse(manager, ref);

      const eod = await this.landEod(manager, universe);

      const disclosures = await this.runs.run(manager, this.disclosure, (runId) =>
        this.landDisclosures(manager, ref, runId),
      );
      announcementIdsToSummarize = disclosures.value.announcementIdsToSummarize;

      const news = await this.runs.run(manager, this.news, async (runId) => {
        const headlines = await this.news.fetchHeadlines();
        const newsArticles = await this.persistNews(manager, headlines.rows, runId);
        // Deterministic ticker-tagging (spec 04 §2): a step inside the RSS ingest
        // cadence — not an AI job, not a separate run.
        const newsArticleTags = await this.tagNews(manager, headlines.rows);
        return {
          value: { newsArticles, newsArticleTags },
          failures: headlines.failures,
        };
      });

      const shariah = await this.runs.run(manager, this.shariah, async (runId) => {
        const statuses = await this.shariah.fetchShariahStatuses();
        return {
          value: await this.persistShariah(
            manager,
            statuses.rows,
            ref.companyByStockCode,
            runId,
          ),
          failures: statuses.failures,
        };
      });

      const ipo = await this.runs.run(manager, this.ipo, async (runId) => {
        const listings = await this.ipo.fetchIpoListings();
        return {
          value: await this.persistIpos(manager, listings.rows, runId),
          failures: listings.failures,
        };
      });

      // --- Ordered AFTER EOD + disclosures: ratios (DY needs the dividend
      // corporate actions) + indicator snapshots, lineage = the market run ---
      const materialised = await this.materialise(
        manager,
        universe,
        eod,
        disclosures.value.corporateActionRows,
      );

      // --- Ordered AFTER EOD: cap-weighted index levels (spec 05, ticket 02) ---
      // The index adapter reads the seam (the demo impl cap-weights the same
      // co-generated constituent bars; production ingests a licensed published
      // level), and the worker upserts the reference index rows + one
      // IndexLevel per index per day, lineage-stamped like every sourced row.
      const index = await this.runs.run(manager, this.index, async (runId) => {
        const series = await this.index.fetchIndexLevels();
        return {
          value: await this.persistIndexLevels(manager, series.rows, runId),
          failures: series.failures,
        };
      });

      const result: NightlyIngestResult = {
        priceBars: eod.value.priceBars,
        quarterlyRows: eod.value.quarterlyRows,
        ...materialised,
        announcements: disclosures.value.announcements,
        corporateActions: disclosures.value.corporateActions,
        ...news.value,
        shariahStatuses: shariah.value,
        ipoListings: ipo.value,
        ...index.value,
        failures: [eod, disclosures, news, shariah, ipo, index].flatMap(
          (run) => run.failures,
        ),
      };
      // ADR-0010: every log line carries a correlationId.  The nightly ingest is
      // not a JobBus job so there is no envelope id; the market run id is the
      // per-run stitch key that ties every persisted row back to this ingest.
      this.logger.log(
        { correlationId: eod.runId, msg: 'nightly-eod-ingest.complete', ...result },
        'nightly-eod-ingest.complete',
      );
      return result;
    });

    // Class-2 cache invalidation AFTER the transaction commits (ADR-0004): the
    // demo disclosure + RSS snapshot lands inside this same nightly
    // transaction, so one post-commit sweep covers the EOD-derived AND
    // disclosure/news-derived caches. A failure here fails the ingest loudly —
    // a stale page shown after new data committed is worse than a retried ingest.
    await this.readCache.changed({ kind: 'eodIngested' });

    // Spec-06 ticket 03: enqueue a `summarize-announcement` job per NOT-YET-
    // SUMMARIZED announcement (persistAnnouncements already narrowed the list
    // to `aiSummary IS NULL` — the cost-bounding half) AFTER commit — the
    // Python worker fetches the announcement via NestJS's own read API, which
    // must see committed data. Content-derived `jobId`s (ADR-0007 §2)
    // additionally collapse a concurrent duplicate enqueue to one job.
    for (const announcementId of announcementIdsToSummarize) {
      const envelope: JobEnvelope<AnnouncementSummaryPayload> = {
        correlationId: randomUUID(),
        requestedBy: 'system',
        trigger: 'system',
        asOf: new Date().toISOString(),
        payload: { announcementId },
      };
      await this.jobBus.enqueue(JobNames.announcementSummary, envelope);
    }

    await this.afterMarketUniverseIngested();

    return result;
  }

  /**
   * The instruments the bound market adapter's bars belong to (its declared
   * {@link MarketDataAdapter.universe}). `reference` is the curated demo set
   * `ensureReferenceData` already upserted; `klci30` upserts the KLCI 30 (PoC
   * Phase A ticket 03: the nightly needs no prior `seed-klci`).
   */
  private async ensureMarketUniverse(
    manager: EntityManager,
    ref: ReferenceIds,
  ): Promise<ReferenceIds> {
    switch (this.market.universe) {
      case 'reference':
        return ref;
      case 'klci30':
        return this.klciSeed.upsertKlciUniverse(manager);
    }
  }

  /**
   * The universe's post-commit follow-on. PoC Phase A ticket 05: the KLCI 30
   * gets the same TA/FA enqueue as `enqueue-klci` (same-day skip, no force);
   * the curated demo set has none (no AI spend on the demo nightly).
   */
  private async afterMarketUniverseIngested(): Promise<void> {
    switch (this.market.universe) {
      case 'reference':
        return;
      case 'klci30':
        await this.klciEnqueue.enqueue();
        return;
    }
  }

  /**
   * EOD step: bars + fundamentals into ONE run opened from the market adapter
   * (the A1 co-generation unit on the synthetic path; the KLCI pull on
   * yfinance). Fundamentals land in the market's run, so both adapters must
   * declare the same provenance class.
   */
  private landEod(
    manager: EntityManager,
    ids: ReferenceIds,
  ): Promise<RunOutcome<EodLanded>> {
    if (this.fundamentals.provenanceClass !== this.market.provenanceClass) {
      throw new Error(
        `EOD step: ${this.fundamentals.adapterName} (${this.fundamentals.provenanceClass}) cannot land in ` +
          `${this.market.adapterName}'s ${this.market.provenanceClass} run`,
      );
    }
    return this.runs.run(manager, this.market, async (runId) => {
      const bars = await this.market.fetchDailyBars();
      const priceBars = await this.persistPriceBars(
        manager,
        bars.rows,
        ids.instrumentByStockCode,
        runId,
      );
      const fundamentals = await this.fundamentals.fetchFundamentals();
      const quarterlyRows = await this.persistQuarterly(
        manager,
        fundamentals.rows,
        ids.companyByStockCode,
        runId,
      );
      return {
        value: { bars: bars.rows, fundamentals, priceBars, quarterlyRows },
        failures: [...bars.failures, ...fundamentals.failures],
      };
    });
  }

  /** Disclosure step: announcements + corporate actions into one run. */
  private async landDisclosures(
    manager: EntityManager,
    ref: ReferenceIds,
    runId: string,
  ): Promise<{ value: DisclosuresLanded; failures: readonly string[] }> {
    const announcementsFetch = await this.disclosure.fetchAnnouncements();
    const { count: announcements, ids: announcementIdsToSummarize } =
      await this.persistAnnouncements(
        manager,
        announcementsFetch.rows,
        ref.companyByStockCode,
        runId,
      );
    const actionsFetch = await this.disclosure.fetchCorporateActions();
    const corporateActions = await this.persistCorporateActions(
      manager,
      actionsFetch.rows,
      ref.companyByStockCode,
      runId,
    );
    return {
      value: {
        announcements,
        announcementIdsToSummarize,
        corporateActions,
        corporateActionRows: actionsFetch.rows,
      },
      failures: [...announcementsFetch.failures, ...actionsFetch.failures],
    };
  }

  /**
   * Materialise step (ordered AFTER the EOD land): one {@link FundamentalsSnapshot}
   * per company with bars, then one {@link IndicatorSnapshot} per instrument,
   * both stamped with the EOD (market) run.
   *
   * DY's dividends: the fundamentals fetch's vendor `dividends` when it carries
   * them (yfinance), else the dividend corporate actions (the CONTEXT single
   * source). See `FundamentalsFetch.dividends` for why yfinance still deviates.
   */
  private async materialise(
    manager: EntityManager,
    ids: ReferenceIds,
    eod: RunOutcome<EodLanded>,
    corporateActions: readonly CorporateActionDto[],
  ): Promise<{ fundamentalsSnapshots: number; indicatorSnapshots: number }> {
    const { bars, fundamentals } = eod.value;
    const barsByStockCode = groupBy(bars, (b) => b.stockCode);
    const dividendsByStockCode = groupBy(
      fundamentals.dividends ?? dividendCorporateActions(corporateActions),
      (d) => d.stockCode,
    );

    const snapshotRepo = manager.getRepository(FundamentalsSnapshot);
    let fundamentalsSnapshots = 0;
    for (const fund of fundamentals.rows) {
      const companyId = ids.companyByStockCode.get(fund.stockCode);
      const companyBars = barsByStockCode.get(fund.stockCode) ?? [];
      if (!companyId || companyBars.length === 0) continue;
      const dividends = dividendsByStockCode.get(fund.stockCode) ?? [];
      const snap = materialiseSnapshot(fund, companyBars, dividends);
      await snapshotRepo.upsert(
        snapshotRepo.create({
          companyId,
          ...snap,
          ingestionRunId: eod.runId,
        }),
        ['companyId'],
      );
      fundamentalsSnapshots++;
    }

    const indicatorSnapshots = await this.materialiseIndicators(
      manager,
      ids.instrumentByStockCode,
      eod.runId,
    );
    return { fundamentalsSnapshots, indicatorSnapshots };
  }

  private async resolveKlciReferenceIds(
    manager: EntityManager,
  ): Promise<ReferenceIds> {
    const instrumentRepo = manager.getRepository(Instrument);
    const companyByStockCode = new Map<string, string>();
    const instrumentByStockCode = new Map<string, string>();
    const missing: string[] = [];
    for (const row of KLCI30_UNIVERSE) {
      const instrument = await instrumentRepo.findOne({
        where: { stockCode: row.stockCode },
      });
      if (!instrument) {
        missing.push(row.stockCode);
        continue;
      }
      companyByStockCode.set(row.stockCode, instrument.companyId);
      instrumentByStockCode.set(row.stockCode, instrument.id);
    }
    if (missing.length > 0) {
      throw new Error(
        `ingest-klci: missing instruments for ${missing.join(',')}; run seed-klci first`,
      );
    }
    return { instrumentByStockCode, companyByStockCode };
  }

  private async persistPriceBars(
    manager: EntityManager,
    bars: readonly PriceBarDto[],
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
    // Upsert on (instrument, tradeDate) so a re-ingest updates in place; chunked
    // because TypeORM's upsert has no chunk option and a single statement would
    // approach the 65,535 Postgres bind-parameter limit at demo scale.
    for (const part of chunk(rows, PRICE_BAR_UPSERT_CHUNK)) {
      await repo.upsert(part, ['instrumentId', 'tradeDate']);
    }
    return rows.length;
  }

  private async persistQuarterly(
    manager: EntityManager,
    fundamentals: readonly FundamentalsDto[],
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
    // Upsert on (company, fiscalYear, fiscalQuarter) — re-ingest updates in place.
    await repo.upsert(rows, ['companyId', 'fiscalYear', 'fiscalQuarter']);
    return rows.length;
  }

  /**
   * Returns `{ count, ids }`: `count` is every upserted row; `ids` is the
   * NOT-YET-SUMMARIZED subset only (`aiSummary IS NULL`), re-read on the
   * natural key since `upsert` itself returns neither inserted/updated status
   * nor ids. `runNightly` enqueues a `summarize-announcement` job per id after
   * the transaction commits (spec 06, ticket 03).
   *
   * Narrowing to `aiSummary IS NULL` is the cost-bounding half of "enqueues
   * per newly-ingested/updated announcement" (ticket 03): the demo aggregator
   * re-serves the same disclosure snapshot every nightly ingest, and the
   * natural key (company, filedAt, title) means a genuinely corrected title
   * lands as a NEW row (new key) with a fresh `aiSummary IS NULL` anyway — so
   * this one predicate covers both "new" and "title-corrected" without ever
   * re-summarizing an already-summarized, unchanged row every single night
   * (spec 06's "AI cost bounded by us" operator goal).
   */
  private async persistAnnouncements(
    manager: EntityManager,
    dtos: readonly AnnouncementDto[],
    companyByStockCode: Map<string, string>,
    runId: string,
  ): Promise<{ count: number; ids: string[] }> {
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
    if (rows.length === 0) return { count: 0, ids: [] };

    // Upsert on (company, filedAt, title) — re-ingest updates in place.
    await repo.upsert(rows, ['companyId', 'filedAt', 'title']);

    const ids: string[] = [];
    if (rows.length > 0) {
      const companyIds = rows.map((r) => r.companyId);
      const filedAts = rows.map((r) => r.filedAt);
      const titles = rows.map((r) => r.title);
      const upsertedRows = await repo.query(
        `SELECT id FROM announcements WHERE (company_id, filed_at, title) = ANY(SELECT * FROM unnest($1::uuid[], $2::timestamptz[], $3::text[])) AND ai_summary IS NULL`,
        [companyIds, filedAts, titles],
      );
      ids.push(...upsertedRows.map((r: { id: string }) => r.id));
    }
    return { count: rows.length, ids };
  }

  private async persistCorporateActions(
    manager: EntityManager,
    dtos: readonly CorporateActionDto[],
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
    // Upsert on (company, type, exDate) — re-ingest updates in place.
    if (rows.length > 0) {
      await repo.upsert(rows, ['companyId', 'type', 'exDate']);
    }
    return rows.length;
  }

  private async persistNews(
    manager: EntityManager,
    dtos: readonly NewsArticleDto[],
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
    // Upsert on the canonical url — re-ingesting the RSS feed is idempotent
    // (stable row ids, so news tags survive a re-run).
    if (rows.length > 0) {
      await repo.upsert(rows, ['url']);
    }
    return rows.length;
  }

  /**
   * Deterministic news ticker-tagging (spec 04 §2): whole-word alias-match each
   * ingested headline against every listed company and write the
   * {@link NewsArticleTag} rows with the matched alias. Tags are DERIVED rows —
   * this replaces an article's tag set (delete + reinsert) rather than
   * upserting, so a re-ingest whose headline changed drops the stale tags;
   * article ids are stable (the url natural key), so unchanged tag rows simply
   * land again. No confident match → the article stays untagged (market-level).
   */
  private async tagNews(
    manager: EntityManager,
    dtos: readonly NewsArticleDto[],
  ): Promise<number> {
    if (dtos.length === 0) return 0;
    const companies = await this.loadTaggableCompanies(manager);
    if (companies.length === 0) return 0;

    const articleRepo = manager.getRepository(NewsArticle);
    const articles = await articleRepo.find({
      where: { url: In(dtos.map((d) => d.url)) },
    });
    const byUrl = new Map(articles.map((a) => [a.url, a]));

    const tagRepo = manager.getRepository(NewsArticleTag);
    let written = 0;
    for (const dto of dtos) {
      const article = byUrl.get(dto.url);
      if (!article) continue;
      const matches = matchCompanyTags(article.headline, companies);
      await tagRepo.delete({ newsArticleId: article.id });
      if (matches.length === 0) continue;
      await tagRepo.insert(
        matches.map((m) =>
          tagRepo.create({
            newsArticleId: article.id,
            companyId: m.companyId,
            matchedAlias: m.matchedAlias,
          }),
        ),
      );
      written += matches.length;
    }
    return written;
  }

  /**
   * Company ⋈ Instrument alias sets for the tagger (`shortName` lives on the
   * Instrument, `fullName` + curated `aliases` on the Company; one entry per
   * company — the first instrument's shortName).
   */
  private async loadTaggableCompanies(
    manager: EntityManager,
  ): Promise<TaggableCompany[]> {
    const instruments = await manager.getRepository(Instrument).find({
      relations: { company: true },
    });
    const byCompany = new Map<string, TaggableCompany>();
    for (const instrument of instruments) {
      if (byCompany.has(instrument.companyId)) continue;
      byCompany.set(instrument.companyId, {
        companyId: instrument.companyId,
        shortName: instrument.shortName,
        fullName: instrument.company.fullName,
        aliases: instrument.company.aliases,
      });
    }
    return [...byCompany.values()];
  }

  private async persistShariah(
    manager: EntityManager,
    dtos: readonly ShariahStatusDto[],
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
    // Upsert on the history-table key (company, effectiveDate) — the ticket-05
    // first hard failure; re-ingest updates the verdict in place.
    if (rows.length > 0) {
      await repo.upsert(rows, ['companyId', 'effectiveDate']);
    }
    return rows.length;
  }

  private async persistIpos(
    manager: EntityManager,
    dtos: readonly IpoListingDto[],
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
    // Upsert on (companyName, listingDate) — re-ingest updates in place; the
    // constraint is NULLS NOT DISTINCT so an undated row still conflicts.
    if (rows.length > 0) {
      await repo.upsert(rows, ['companyName', 'listingDate']);
    }
    return rows.length;
  }

  /**
   * Persist the index series the {@link IndexAdapter} served (spec 05, ticket
   * 02): upsert the reference {@link MarketIndex} row on its `(kind, sectorId)`
   * natural key (resolving the DTO's sector name onto the real reference
   * Sector; the headline row is the one with a null Sector), then upsert that
   * index's {@link IndexLevel} series on `(index, date)` — so a re-ingest
   * updates levels in place: stable row ids, lineage re-pointed to the fresh
   * run. The live intraday level is Redis-only (class 3) and never lands here.
   */
  private async persistIndexLevels(
    manager: EntityManager,
    series: readonly IndexLevelsDto[],
    runId: string,
  ): Promise<{ marketIndices: number; indexLevels: number }> {
    const indexRepo = manager.getRepository(MarketIndex);
    const levelRepo = manager.getRepository(IndexLevel);
    const sectorRepo = manager.getRepository(Sector);

    let marketIndices = 0;
    let indexLevels = 0;
    for (const s of series) {
      let sectorId: string | null = null;
      if (s.sectorName !== null) {
        const sector = await sectorRepo.findOne({
          where: { name: s.sectorName },
        });
        if (!sector) {
          throw new Error(
            `persistIndexLevels: unknown sector ${s.sectorName}`,
          );
        }
        sectorId = sector.id;
      }
      await indexRepo.upsert(
        indexRepo.create({
          kind: s.kind,
          name: s.name,
          sectorId,
          ingestionRunId: runId,
        }),
        ['kind', 'sectorId'],
      );
      marketIndices++;
      // Upsert returns no id — re-read on the natural key for the level FKs
      // (the headline row is the only row of its kind, so kind alone locates it).
      const indexRow =
        sectorId === null
          ? await indexRepo.findOneOrFail({ where: { kind: s.kind } })
          : await indexRepo.findOneOrFail({
              where: { kind: s.kind, sectorId },
            });
      const rows = s.levels.map((l) =>
        levelRepo.create({
          indexId: indexRow.id,
          levelDate: l.levelDate,
          level: l.level.toFixed(6),
          ingestionRunId: runId,
        }),
      );
      if (rows.length > 0) {
        await levelRepo.upsert(rows, ['indexId', 'levelDate']);
      }
      indexLevels += rows.length;
    }
    return { marketIndices, indexLevels };
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

      await snapshotRepo.upsert(
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
        // Upsert on (instrument) — one current snapshot per instrument,
        // re-ingest recomputes it in place.
        ['instrumentId'],
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

/** Price bars per upsert statement (keeps bind parameters well under the 65,535 Postgres limit). */
const PRICE_BAR_UPSERT_CHUNK = 1_000;

/** Split an array into fixed-size chunks. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * The dividend corporate actions as DY inputs (CONTEXT: DY = trailing-12-month
 * DIVIDEND corporate actions). Other action types never feed DY, even when
 * they carry a cash amount (rights).
 */
function dividendCorporateActions(
  actions: readonly CorporateActionDto[],
): DividendDto[] {
  const out: DividendDto[] = [];
  for (const a of actions) {
    if (a.type !== CorporateActionType.Dividend || a.amount === null) continue;
    out.push({ stockCode: a.stockCode, exDate: a.exDate, amount: a.amount });
  }
  return out;
}
