/**
 * Stock-page module (spec 02; ticket 03; PoC Phase A ticket 06).
 *
 * Wires the anonymous browse reads (core / disclosures) plus PoC series +
 * analysis thin reads and cost-stripped artifact proxies. `DataModule`
 * supplies the `DataSource`; `CacheModule` the class-2 `ReadCacheService`;
 * `S3Module` the claim-check artifact fetch. No invalidation hooks live here:
 * the nightly ingest and the decision-B purge sweep the `cache:stocks:`
 * prefix after commit (ticket 01).
 */

import { Module } from '@nestjs/common';
import { CacheModule } from '../cache/cache.module';
import { DataModule } from '../data/data.module';
import { S3Module } from '../s3/s3.module';
import { StocksController } from './stocks.controller';
import { StocksService } from './stocks.service';

@Module({
  imports: [DataModule, CacheModule, S3Module],
  controllers: [StocksController],
  providers: [StocksService],
})
export class StocksModule {}
