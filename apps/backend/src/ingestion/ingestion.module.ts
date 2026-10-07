import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DataModule } from '../data/data.module';
import { AdaptersModule } from '../data/adapters/adapters.module';
import { CacheModule } from '../cache/cache.module';
import { S3Module } from '../s3/s3.module';
import { JobBusModule } from '../jobbus/job-bus.module';
import { EodIngestService } from './eod-ingest.service';
import { IngestionRunService } from './ingestion-run.service';
import { ReferenceDataService } from './reference-data.service';
import { IntradayReplayService } from './intraday-replay.service';
import { PurgeService } from './purge.service';
import { IngestionScheduler } from './ingestion.scheduler';
import { ProspectusCorpusService } from './prospectus-corpus.service';
import { ProspectusEnqueueService } from './prospectus-enqueue.service';

/**
 * Ingestion worker module (spec 01 process shape; ticket 04, ADR-0012).
 *
 * The dedicated NestJS **ingestion worker** context — booted by `worker-main.ts`
 * via `NestFactory.createApplicationContext`, sharing the same `apps/backend`
 * entities/migrations/DB connection as the API (ADR-0004 sole-writer: both NestJS
 * processes are the same writer). NOT a separate workspace (ADR-0002).
 *
 * CRON ISOLATION: `ScheduleModule.forRoot()` and {@link IngestionScheduler} live
 * ONLY here. The API `AppModule` does not import this module, so it registers no
 * schedule jobs and nothing double-fires — the cron-isolation guarantee, pinned by
 * `ingestion.cron-isolation.spec.ts`.
 *
 * Reads the source-adapter seam ({@link AdaptersModule}) through DI tokens, so a
 * licensed production adapter swaps in with no worker change.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    DataModule,
    AdaptersModule,
    CacheModule,
    JobBusModule,
    S3Module,
  ],
  providers: [
    IngestionRunService,
    ReferenceDataService,
    EodIngestService,
    IntradayReplayService,
    PurgeService,
    IngestionScheduler,
    ProspectusCorpusService,
    ProspectusEnqueueService,
  ],
  exports: [
    EodIngestService,
    IntradayReplayService,
    PurgeService,
    ReferenceDataService,
    IngestionRunService,
    ProspectusCorpusService,
    ProspectusEnqueueService,
  ],
})
export class IngestionModule {}
