/**
 * Decision-B licence-boundary purge (spec 01 "Provenance"; ticket 04).
 *
 * Deletes every sourced row whose {@link IngestionRun} is `synthetic` or
 * `aggregator`, leaving `real` reference data (Company/Instrument/Sector, manual
 * Shariah/IPO) AND the lineage rows themselves intact. This is the targeted delete
 * the lineage model was chosen to enable: crossing to a public launch is one
 * command, and provenance survives usefully into production (no go-live tech debt).
 *
 * The purge is by-lineage, not by-table-scan: it collects the ids of runs in the
 * purged classes and deletes the data rows FK'd to them, per table. It does NOT
 * delete the `ingestion_runs` rows (lineage survives), and it does NOT touch rows
 * FK'd to `real` runs. `onDelete: RESTRICT` on the run FKs is why we delete the
 * data rows first and keep the runs.
 */

import { Injectable, Logger } from '@nestjs/common';
import { DataSource, In, type EntityManager } from 'typeorm';
import { Announcement } from '../data/entities/announcement.entity';
import { CorporateAction } from '../data/entities/corporate-action.entity';
import { FundamentalsSnapshot } from '../data/entities/fundamentals-snapshot.entity';
import { IndicatorSnapshot } from '../data/entities/indicator-snapshot.entity';
import { IngestionRun } from '../data/entities/ingestion-run.entity';
import { NewsArticle } from '../data/entities/news-article.entity';
import { PriceBar } from '../data/entities/price-bar.entity';
import { QuarterlyFinancials } from '../data/entities/quarterly-financials.entity';
import { ProvenanceClass } from '../data/entities/enums';
import { ReadCacheService, SEARCH_CACHE_PREFIX, STOCKS_CACHE_PREFIX, DISCLOSURES_CACHE_PREFIX, SCREENER_CACHE_PREFIX } from '../cache';

/** Rows deleted per table (returned for logging / test assertions). */
export interface PurgeResult {
  priceBars: number;
  quarterlyFinancials: number;
  fundamentalsSnapshots: number;
  indicatorSnapshots: number;
  announcements: number;
  corporateActions: number;
  newsArticles: number;
  /** Number of ingestion-run rows deliberately LEFT intact (lineage survives). */
  runsPreserved: number;
}

/** The provenance classes the decision-B purge targets. */
const PURGED_CLASSES: readonly ProvenanceClass[] = [
  ProvenanceClass.Synthetic,
  ProvenanceClass.Aggregator,
];

@Injectable()
export class PurgeService {
  private readonly logger = new Logger(PurgeService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly readCache: ReadCacheService,
  ) {}

  /** Run the decision-B purge in a single transaction. */
  async purgeUnlicensed(): Promise<PurgeResult> {
    const result = await this.dataSource.transaction(async (manager) =>
      this.purgeWithManager(manager),
    );

    // Class-2 cache invalidation AFTER the commit (ADR-0004): the purge just
    // changed what every cached read page would show — the whole point is
    // that no stale synthetic/aggregator page survives the licence crossing.
    await this.readCache.invalidatePrefix(SEARCH_CACHE_PREFIX);
    await this.readCache.invalidatePrefix(STOCKS_CACHE_PREFIX);
    await this.readCache.invalidatePrefix(DISCLOSURES_CACHE_PREFIX);
    await this.readCache.invalidatePrefix(SCREENER_CACHE_PREFIX);
    return result;
  }

  /** Purge using a caller-supplied manager (lets tests share a data source). */
  async purgeWithManager(manager: EntityManager): Promise<PurgeResult> {
    const runRepo = manager.getRepository(IngestionRun);
    const purgedRuns = await runRepo.find({
      where: { provenanceClass: In([...PURGED_CLASSES]) },
      select: { id: true },
    });
    const runIds = purgedRuns.map((r) => r.id);

    const result: PurgeResult = {
      priceBars: 0,
      quarterlyFinancials: 0,
      fundamentalsSnapshots: 0,
      indicatorSnapshots: 0,
      announcements: 0,
      corporateActions: 0,
      newsArticles: 0,
      runsPreserved: purgedRuns.length,
    };

    if (runIds.length === 0) {
      return result;
    }

    // Delete data rows FK'd to a purged run, per table. Runs are kept (lineage).
    result.priceBars = await this.deleteByRun(manager, PriceBar, runIds);
    result.quarterlyFinancials = await this.deleteByRun(
      manager,
      QuarterlyFinancials,
      runIds,
    );
    result.fundamentalsSnapshots = await this.deleteByRun(
      manager,
      FundamentalsSnapshot,
      runIds,
    );
    result.indicatorSnapshots = await this.deleteByRun(
      manager,
      IndicatorSnapshot,
      runIds,
    );
    result.announcements = await this.deleteByRun(manager, Announcement, runIds);
    result.corporateActions = await this.deleteByRun(
      manager,
      CorporateAction,
      runIds,
    );
    result.newsArticles = await this.deleteByRun(manager, NewsArticle, runIds);

    this.logger.warn(
      `decision-B purge complete (lineage preserved): ${JSON.stringify(result)}`,
    );
    return result;
  }

  private async deleteByRun<T extends { ingestionRunId: string }>(
    manager: EntityManager,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    entity: new () => T,
    runIds: string[],
  ): Promise<number> {
    const res = await manager
      .getRepository<T>(entity)
      .createQueryBuilder()
      .delete()
      .where('ingestion_run_id IN (:...runIds)', { runIds })
      .execute();
    return res.affected ?? 0;
  }
}
