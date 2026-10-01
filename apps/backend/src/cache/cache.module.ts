import { Module } from '@nestjs/common';
import { ReadCacheService } from './read-cache.service';

/**
 * ADR-0004 class-2 read-through cache module. Plain (not `@Global`) on
 * purpose: consumers — the spec-02 read endpoints, the ingestion worker's
 * invalidation hooks, later specs 03–05 — import it explicitly, which keeps
 * the read-cache dependency visible on every module that touches it.
 */
@Module({
  providers: [ReadCacheService],
  exports: [ReadCacheService],
})
export class CacheModule {}
