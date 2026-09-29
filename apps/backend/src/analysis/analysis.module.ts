import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataModule } from '../data/data.module';
import { JobBusModule } from '../jobbus/job-bus.module';
import { AnalysisResult } from '../data/entities/analysis-result.entity';
import { AnalysisController } from './analysis.controller';
import { AnalysisResultStore } from './analysis-result.store';

/**
 * Analysis module (ticket 06 round-trip proof). Wires the FE-facing enqueue/read
 * HTTP surface to the JobBus seam (ADR-0001) and the Postgres index-of-record
 * (ADR-0004). No product logic — it exists to make `docker compose up`
 * verifiable end to end.
 */
@Module({
  imports: [DataModule, JobBusModule, TypeOrmModule.forFeature([AnalysisResult])],
  controllers: [AnalysisController],
  providers: [AnalysisResultStore],
})
export class AnalysisModule {}
