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

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EodIngestService } from './eod-ingest.service';
import { IntradayReplayService } from './intraday-replay.service';

@Injectable()
export class IngestionScheduler {
  private readonly logger = new Logger(IngestionScheduler.name);

  constructor(
    private readonly eod: EodIngestService,
    private readonly intraday: IntradayReplayService,
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
   * Bursa continuous-trading window, 09:00–16:45 MYT (UTC+8). Evaluated in MYT so
   * it is independent of the host timezone.
   */
  static isMarketHours(now: Date): boolean {
    // Convert to MYT (UTC+8) without a TZ library.
    const myt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const minutes = myt.getUTCHours() * 60 + myt.getUTCMinutes();
    const open = 9 * 60; // 09:00
    const close = 16 * 60 + 45; // 16:45
    return minutes >= open && minutes <= close;
  }
}
