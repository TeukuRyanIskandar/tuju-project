import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataModule } from '../data/data.module';
import { CacheModule } from '../cache/cache.module';
import { JobBusModule } from '../jobbus/job-bus.module';
import { S3Module } from '../s3/s3.module';
import { ProspectusAnalysis } from '../data/entities/prospectus-analysis.entity';
import { IpoController } from './ipo.controller';
import { IpoService } from './ipo.service';
import { ProspectusAnalysisStore } from './prospectus-analysis.store';

/**
 * IPO prospectus at-a-glance module (spec 06, ticket 05): the anonymous reads
 * (`/ipo/:prospectusId/...`) plus the JobBus result-writer for
 * `analyze-prospectus` — the prospectus sibling of `MarketBriefModule`.
 * API process only (the ops enqueue lives in the worker's `IngestionModule`).
 */
@Module({
  imports: [
    DataModule,
    CacheModule,
    JobBusModule,
    S3Module,
    TypeOrmModule.forFeature([ProspectusAnalysis]),
  ],
  controllers: [IpoController],
  providers: [IpoService, ProspectusAnalysisStore],
})
export class IpoModule {}
