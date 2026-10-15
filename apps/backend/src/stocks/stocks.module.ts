/**
 * Stock-page module (spec 02; ticket 03; PoC Phase A ticket 06).
 *
 * Wires the anonymous browse reads (core / disclosures) plus PoC series.
 * The TA/FA envelope reads and their artifact proxies are delegated to
 * `StockAnalysis` (`AnalysisModule`). `DataModule` supplies the `DataSource`;
 * `CacheModule` the class-2 `ReadModelCache`. No invalidation hooks live here:
 * writers announce their changes and the cache module decides what goes stale.
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '../cache/cache.module';
import { DataModule } from '../data/data.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { StocksController } from './stocks.controller';
import { StocksService } from './stocks.service';
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
    AnalysisModule,
    TypeOrmModule.forFeature([
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
