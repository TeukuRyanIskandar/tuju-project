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
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '../cache/cache.module';
import { DataModule } from '../data/data.module';
import { S3Module } from '../s3/s3.module';
import { StocksController } from './stocks.controller';
import { StocksService } from './stocks.service';
import { TechnicalAnalysis } from '../data/entities/technical-analysis.entity';
import { FundamentalAnalysis } from '../data/entities/fundamental-analysis.entity';
import { IndicatorSnapshot } from '../data/entities/indicator-snapshot.entity';
import { FundamentalsSnapshot } from '../data/entities/fundamentals-snapshot.entity';
import { QuarterlyFinancials } from '../data/entities/quarterly-financials.entity';
import { PriceBar } from '../data/entities/price-bar.entity';
import { Announcement } from '../data/entities/announcement.entity';
import { CorporateAction } from '../data/entities/corporate-action.entity';
import { ShariahStatus } from '../data/entities/shariah-status.entity';
import { Instrument } from '../data/entities/instrument.entity';

@Module({
  imports: [
    DataModule,
    CacheModule,
    S3Module,
    TypeOrmModule.forFeature([
      TechnicalAnalysis,
      FundamentalAnalysis,
      IndicatorSnapshot,
      FundamentalsSnapshot,
      QuarterlyFinancials,
      PriceBar,
      Announcement,
      CorporateAction,
      ShariahStatus,
      Instrument,
    ]),
  ],
  controllers: [StocksController],
  providers: [StocksService],
})
export class StocksModule {}
