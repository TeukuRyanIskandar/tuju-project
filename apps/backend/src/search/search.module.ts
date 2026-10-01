import { Module } from '@nestjs/common';
import { DataModule } from '../data/data.module';
import { CacheModule } from '../cache/cache.module';
import { PgInstrumentSearch } from './instrument-search.pg';
import { INSTRUMENT_SEARCH } from './instrument-search.interface';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/**
 * Search module (spec 02; ticket 02) — the anonymous `GET /search` surface.
 *
 * Binds the {@link INSTRUMENT_SEARCH} seam to its Postgres/pg_trgm
 * implementation (a future external search engine swaps at THIS binding,
 * nothing else changes) and composes the data layer (DataSource via
 * DataModule, matching the ingestion module's plain-provider DI) and the
 * class-2 read cache. Owns no schedule/worker bits — those stay isolated in
 * the ingestion worker (the cron-isolation rule).
 *
 * Wired into `AppModule` by the orchestrator after wave 2.
 */
@Module({
  imports: [DataModule, CacheModule],
  controllers: [SearchController],
  providers: [
    { provide: INSTRUMENT_SEARCH, useClass: PgInstrumentSearch },
    SearchService,
  ],
  exports: [SearchService],
})
export class SearchModule {}
