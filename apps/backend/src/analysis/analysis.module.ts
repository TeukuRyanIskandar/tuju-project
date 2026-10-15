import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '../cache/cache.module';
import { DataModule } from '../data/data.module';
import { JobBusModule } from '../jobbus/job-bus.module';
import { S3Module } from '../s3/s3.module';
import { AnalysisResult } from '../data/entities/analysis-result.entity';
import { TechnicalAnalysis } from '../data/entities/technical-analysis.entity';
import { FundamentalAnalysis } from '../data/entities/fundamental-analysis.entity';
import { Instrument } from '../data/entities/instrument.entity';
import { PriceBar } from '../data/entities/price-bar.entity';
import { AnalysisController } from './analysis.controller';
import { AnalysisResultStore } from './analysis-result.store';
import { StockAnalysis } from './stock-analysis';

/**
 * Analysis module (ticket 06 round-trip proof). Wires the FE-facing enqueue/read
 * HTTP surface to the JobBus seam (ADR-0001) and the Postgres index-of-record
 * (ADR-0004). PoC Phase A adds thin TA/FA status tables
 * (technical_analyses / fundamental_analyses), owned end to end (pending /
 * land / fail, status envelope, artifact proxy) by `StockAnalysis`, alongside
 * the scaffold analysis_results writer.
 */
@Module({
  imports: [
    DataModule,
    CacheModule,
    JobBusModule,
    S3Module,
    TypeOrmModule.forFeature([
      AnalysisResult,
      TechnicalAnalysis,
      FundamentalAnalysis,
      Instrument,
      PriceBar,
    ]),
  ],
  controllers: [AnalysisController],
  providers: [AnalysisResultStore, StockAnalysis],
  exports: [StockAnalysis],
})
export class AnalysisModule {}
