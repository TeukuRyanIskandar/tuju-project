/**
 * Stock-page module (spec 02; ticket 03).
 *
 * Wires the three anonymous read endpoints. `DataModule` supplies the
 * `DataSource` (TypeORM 0.3, sole-writer ADR-0004) and `CacheModule` the
 * ticket-01 `ReadCacheService` — imported explicitly (the cache module is
 * deliberately not `@Global`) so this module's read-cache dependency stays
 * visible. No invalidation hooks live here: the nightly ingest and the
 * decision-B purge sweep the `cache:stocks:` prefix after commit (ticket 01).
 *
 * The orchestrator wires this into `AppModule` after wave 2 (this ticket owns
 * only `src/stocks/`; `app.module.ts` is untouched).
 */

import { Module } from '@nestjs/common';
import { CacheModule } from '../cache/cache.module';
import { DataModule } from '../data/data.module';
import { StocksController } from './stocks.controller';
import { StocksService } from './stocks.service';

@Module({
  imports: [DataModule, CacheModule],
  controllers: [StocksController],
  providers: [StocksService],
})
export class StocksModule {}
