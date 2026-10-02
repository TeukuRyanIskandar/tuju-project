import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { JobResult } from '@tuju/contracts';
import { JobBus } from '../jobbus/job-bus.service';
import { Announcement } from '../data/entities/announcement.entity';

/**
 * The Python worker's own `JobResult.jobId` prefix (colon-joined) — mirrors
 * `ANNOUNCEMENT_SUMMARY_JOB_ID_PREFIX` in `services/ai/src/tuju_ai/config.py`
 * by hand (no shared cross-language constant for this; keep both in lock-step).
 */
const JOB_ID_PREFIX = 'ann:';

/**
 * Writes the `summarize-announcement` `JobResult` into the existing
 * `Announcement.aiSummary`/`aiSummaryAsOf` columns (spec 06, ticket 03;
 * ADR-0004 §2) — the one showcase job whose result lands in an existing read
 * model rather than a new table (no claim-check pointer stored: the full
 * artifact in S3 is for audit/re-run only, the thin headline is the product).
 *
 * The announcement id is NOT carried on `JobResult` itself — it is recovered
 * from the Python worker's own content-derived `jobId` (`ann:{announcementId}`,
 * `handler.py`), the same prefix-parsing pattern `MarketBriefStore` uses to
 * recover its `briefDate`. (`AnalysisResultStore` recovers its own domain key —
 * `symbol` — differently, from the claim-check artifact's S3 key, not `jobId`;
 * it has no verdict-less result of its own to parse a prefix out of.)
 */
@Injectable()
export class AnnouncementSummaryStore implements OnModuleInit {
  private readonly logger = new Logger(AnnouncementSummaryStore.name);

  constructor(
    private readonly jobBus: JobBus,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.jobBus.onResult((result: JobResult) => {
      void this.persist(result);
    });
  }

  private async persist(result: JobResult): Promise<void> {
    if (!result.jobId.startsWith(JOB_ID_PREFIX)) return; // not an announcement-summary result
    const announcementId = result.jobId.slice(JOB_ID_PREFIX.length);

    try {
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
      this.logger.log({
        msg: 'announcement summary persisted',
        correlationId: result.correlationId,
        jobId: result.jobId,
        announcementId,
      });
    } catch (err) {
      this.logger.error({
        msg: 'failed to persist announcement summary',
        correlationId: result.correlationId,
        jobId: result.jobId,
        announcementId,
        error: (err as Error).message,
      });
    }
  }
}
