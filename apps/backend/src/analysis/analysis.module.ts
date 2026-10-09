import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataModule } from '../data/data.module';
import { JobBusModule } from '../jobbus/job-bus.module';
import { AnalysisResult } from '../data/entities/analysis-result.entity';
import { TechnicalAnalysis } from '../data/entities/technical-analysis.entity';
import { FundamentalAnalysis } from '../data/entities/fundamental-analysis.entity';
import { Instrument } from '../data/entities/instrument.entity';
import { AnalysisController } from './analysis.controller';
import { AnalysisResultStore } from './analysis-result.store';
import { TechnicalAnalysisStore } from './technical-analysis.store';
import { FundamentalAnalysisStore } from './fundamental-analysis.store';

/**
 * Analysis module (ticket 06 round-trip proof). Wires the FE-facing enqueue/read
 * HTTP surface to the JobBus seam (ADR-0001) and the Postgres index-of-record
 * (ADR-0004). PoC Phase A adds thin TA/FA status tables + JobBus hooks
 * (technical_analyses / fundamental_analyses) alongside the scaffold
 * analysis_results writer.
 */
@Module({
  imports: [
    DataModule,
    JobBusModule,
    TypeOrmModule.forFeature([
      AnalysisResult,
      TechnicalAnalysis,
      FundamentalAnalysis,
      Instrument,
    ]),
  ],
  controllers: [AnalysisController],
  providers: [
    AnalysisResultStore,
    TechnicalAnalysisStore,
    FundamentalAnalysisStore,
  ],
  exports: [TechnicalAnalysisStore, FundamentalAnalysisStore],
})
export class AnalysisModule {}
