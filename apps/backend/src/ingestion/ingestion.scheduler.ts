/**
 * Ingestion cron scheduler (spec 01 cadences; ticket 04, ADR-0012).
 *
 * The `@nestjs/schedule` crons that drive the ingestion worker. This provider is
 * registered ONLY in {@link IngestionModule}, which is loaded ONLY by the worker
 * entrypoint (`worker-main.ts`) — never by the API `AppModule`. That is the
 * cron-isolation guarantee: the API process registers no schedule jobs, so nothing
 * double-fires (asserted by the cron-isolation test).
 *
 * Cadences (spec 01 table):
 *  - nightly EOD prices + co-generated fundamentals, then (ordered after) indicators
 *  - synthetic delayed-intraday replay every 5 min, 09:00–16:45 MYT → Redis only
 *
 * RSS news (~15–30 min) and the static disclosure snapshot are folded into the
 * nightly ingest for the demo; the manual Shariah/IPO refresh is a command (below),
 * not a cron, per the spec.
 */

import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { JobEnvelope, MarketBriefPayload } from '@tuju/contracts';
import { JobBus } from '../jobbus/job-bus.service';
import { JobNames } from '../jobbus/job-names';
import { isMarketHours } from './intraday-model';
import { EodIngestService } from './eod-ingest.service';
import { IntradayReplayService } from './intraday-replay.service';

@Injectable()
export class IngestionScheduler {
  private readonly logger = new Logger(IngestionScheduler.name);

  constructor(
    private readonly eod: EodIngestService,
    private readonly intraday: IntradayReplayService,
    private readonly jobBus: JobBus,
  ) {}

  /**
   * Nightly EOD + fundamentals + (ordered-after) indicators, landing in Postgres.
   * 20:00 UTC ≈ post nominal Bursa close.
   */
  @Cron(CronExpression.EVERY_DAY_AT_8PM, {
    name: 'nightly-eod-ingest',
    timeZone: 'Asia/Kuala_Lumpur',
  })
  async nightlyIngest(): Promise<void> {
    this.logger.log('cron: nightly-eod-ingest firing');
    await this.eod.runNightly();
  }

  /**
   * Nightly daily-market-brief enqueue (spec 06, ticket 02) — system-triggered,
   * no `@RequiresJob` gate (free/anonymous content). Scheduled an hour after
   * the nightly EOD ingest so the brief narrates freshly-ingested index
   * levels; a content-derived `jobId` keyed by date (ADR-0007 §2, derived in
   * `JobBus.deriveJobId`) collapses a same-day re-enqueue to one job.
   */
  @Cron(CronExpression.EVERY_DAY_AT_9PM, {
    name: 'nightly-market-brief',
    timeZone: 'Asia/Kuala_Lumpur',
  })
  async nightlyMarketBrief(): Promise<void> {
    this.logger.log('cron: nightly-market-brief firing');
    const envelope: JobEnvelope<MarketBriefPayload> = {
      correlationId: randomUUID(),
      requestedBy: 'system',
      trigger: 'system',
      asOf: new Date().toISOString(),
      payload: {},
    };
    await this.jobBus.enqueue(JobNames.marketBrief, envelope);
  }

  /**
   * Synthetic delayed-intraday replay every 5 minutes. Touches Redis ONLY (never
   * Postgres). The 09:00–16:45 MYT window is enforced by the guard below so the
   * every-5-min cron is a no-op outside market hours.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, {
    name: 'intraday-replay',
    timeZone: 'Asia/Kuala_Lumpur',
  })
  async intradayReplay(): Promise<void> {
    if (!IngestionScheduler.isMarketHours(new Date())) return;
    await this.intraday.replayTick();
  }

  /**
   * Bursa continuous-trading window, 09:00–16:45 MYT (UTC+8). Delegates to the
   * pure `intraday-model.ts` guard — shared with the market-overview read
   * endpoints (spec 05, tickets 04/05) so the write-side replay and the
   * read-side clock selection agree on exactly one window.
   */
  static isMarketHours(now: Date): boolean {
    return isMarketHours(now);
  }
}
