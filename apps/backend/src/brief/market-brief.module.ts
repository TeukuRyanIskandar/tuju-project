import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataModule } from '../data/data.module';
import { CacheModule } from '../cache/cache.module';
import { JobBusModule } from '../jobbus/job-bus.module';
import { MarketBrief } from '../data/entities/market-brief.entity';
import { MarketBriefController } from './market-brief.controller';
import { MarketBriefStore } from './market-brief.store';

/**
 * Daily market brief module (spec 06, ticket 02). Wires the anonymous
 * `GET /market-brief/latest` read surface to the JobBus seam (ADR-0001), the
 * Postgres index-of-record (ADR-0004), and the class-2 `ReadModelCache` —
 * the `generate-market-brief` sibling of `AnalysisModule`.
 */
@Module({
  imports: [
    DataModule,
    CacheModule,
    JobBusModule,
    TypeOrmModule.forFeature([MarketBrief]),
  ],
  controllers: [MarketBriefController],
  providers: [MarketBriefStore],
})
export class MarketBriefModule {}
