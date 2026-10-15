import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { JobFailure, JobResult } from '@tuju/contracts';
import { JobBus } from '../jobbus/job-bus.service';
import type { JobFamily, JobRef } from '../jobbus/job-family';
import { announcementSummaryIdentity } from '../jobbus/job-identities';
import { ReadModelCache } from '../cache';
import { Announcement } from '../data/entities/announcement.entity';
import { Instrument } from '../data/entities/instrument.entity';

/**
 * The `summarize-announcement` job family: writes the `JobResult` into the existing
 * `Announcement.aiSummary`/`aiSummaryAsOf` columns (spec 06, ticket 03;
 * ADR-0004 §2) — the one showcase job whose result lands in an existing read
 * model rather than a new table (no claim-check pointer stored: the full
 * artifact in S3 is for audit/re-run only, the thin headline is the product).
 *
 * The announcement id is NOT carried on `JobResult` itself — it is the
 * family's key, recovered from the worker's content-derived result id
 * (`ann:{announcementId}`) by `announcementSummaryIdentity`.
 *
 * Landing announces `announcementSummarised` (with the company's stock codes)
 * so the cached feeds and stock-page lists that carry `aiSummary` miss on the
 * next read instead of hiding the summary for a whole cache horizon.
 */
@Injectable()
export class AnnouncementSummaryStore
  implements JobFamily<'summarize-announcement', string>, OnModuleInit
{
  readonly identity = announcementSummaryIdentity;
  private readonly logger = new Logger(AnnouncementSummaryStore.name);

  constructor(
    private readonly jobBus: JobBus,
    private readonly dataSource: DataSource,
    private readonly readCache: ReadModelCache,
  ) {}

  onModuleInit(): void {
    this.jobBus.register(this);
  }

  async land(
    result: JobResult,
    { key: announcementId }: JobRef<'summarize-announcement', string>,
  ): Promise<void> {
    const update = await this.dataSource.getRepository(Announcement).update(
      { id: announcementId },
      {
        aiSummary: result.summary.headline,
        aiSummaryAsOf: new Date(result.summary.asOf),
      },
    );
    if (update.affected === 0) {
      this.logger.warn({
        msg: 'announcement summary: no matching announcement row',
        correlationId: result.correlationId,
        jobId: result.jobId,
        announcementId,
      });
      return;
    }
    await this.readCache.changed({
      kind: 'announcementSummarised',
      announcementId,
      stockCodes: await this.stockCodesOf(announcementId),
    });
    this.logger.log({
      msg: 'announcement summary persisted',
      correlationId: result.correlationId,
      jobId: result.jobId,
      announcementId,
    });
  }

  /** No write on failure: `aiSummary` stays null, so a later nightly re-enqueues it. */
  async fail(
    failure: JobFailure,
    { key: announcementId }: JobRef<'summarize-announcement', string>,
  ): Promise<void> {
    this.logger.error({
      msg: 'announcement summary job failed',
      jobId: failure.jobId,
      announcementId,
      reason: failure.userMessage,
    });
  }

  /** The stock codes of the announcement's company (its stock-page lists). */
  private async stockCodesOf(announcementId: string): Promise<string[]> {
    const rows = await this.dataSource
      .getRepository(Instrument)
      .createQueryBuilder('i')
      .select('i.stockCode', 'stockCode')
      .innerJoin(Announcement, 'a', 'a.companyId = i.companyId')
      .where('a.id = :announcementId', { announcementId })
      .getRawMany<{ stockCode: string }>();
    return rows.map((r) => r.stockCode);
  }
}
