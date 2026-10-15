/**
 * Disclosure read-surface module (spec 04; ticket 02).
 *
 * Wires the five anonymous market-wide read endpoints. `DataModule` supplies
 * the `DataSource` (TypeORM 0.3, sole-writer ADR-0004) and `CacheModule` the
 * class-2 `ReadModelCache` — imported explicitly (the cache module is
 * deliberately not `@Global`) so this module's read-cache dependency stays
 * visible. The reads never invalidate: the nightly ingest, the decision-B
 * purge and `AnnouncementSummaryStore` announce their changes to the cache.
 *
 * The per-company feeds (spec 04's "spec-02's per-company feed") are the
 * spec-02 `StocksModule` routes, extended with the category/type filters —
 * one route per concept (see the effort map's decision).
 */

import { Module } from '@nestjs/common';
import { CacheModule } from '../cache/cache.module';
import { DataModule } from '../data/data.module';
import { JobBusModule } from '../jobbus/job-bus.module';
import { AnnouncementSummaryStore } from './announcement-summary.store';
import { DisclosuresController } from './disclosures.controller';
import { DisclosuresService } from './disclosures.service';

@Module({
  imports: [DataModule, CacheModule, JobBusModule],
  controllers: [DisclosuresController],
  providers: [DisclosuresService, AnnouncementSummaryStore],
})
export class DisclosuresModule {}
