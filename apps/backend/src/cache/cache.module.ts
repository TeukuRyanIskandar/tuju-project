import { Module } from '@nestjs/common';
import { ReadModelCache } from './read-model-cache';

/**
 * ADR-0004 class-2 read-model cache module. Plain (not `@Global`) on
 * purpose: readers (the read endpoints) and writers (ingestion, purge, the
 * job families) import it explicitly, which keeps the cache dependency
 * visible on every module that touches it.
 */
@Module({
  providers: [ReadModelCache],
  exports: [ReadModelCache],
})
export class CacheModule {}
