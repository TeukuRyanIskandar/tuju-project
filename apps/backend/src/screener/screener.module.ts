import { Module } from '@nestjs/common';
import { DataModule } from '../data/data.module';
import { CacheModule } from '../cache/cache.module';
import { PgScreenerQuery } from './screener-query.pg';
import { SCREENER_QUERY } from './screener-query.interface';
import { ScreenerController } from './screener.controller';
import { ScreenerService } from './screener.service';

/**
 * Screener module (spec 03; ticket 02) — the anonymous `GET /screener`
 * surface, the same shape as `SearchModule`.
 *
 * Binds the ticket-01 {@link SCREENER_QUERY} seam to its Postgres read model
 * (a future external screening engine swaps at THIS binding, nothing else
 * changes) and composes the data layer (DataSource via DataModule) + the
 * class-2 read cache. Owns no schedule/worker bits — those stay isolated in
 * the ingestion worker (the cron-isolation rule), and the nightly ingest's
 * `cache:screener:` sweep is already registered (ticket 01).
 */
@Module({
  imports: [DataModule, CacheModule],
  controllers: [ScreenerController],
  providers: [
    { provide: SCREENER_QUERY, useClass: PgScreenerQuery },
    ScreenerService,
  ],
  exports: [ScreenerService],
})
export class ScreenerModule {}
