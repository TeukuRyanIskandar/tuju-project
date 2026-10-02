/**
 * Market-overview module (spec 05, tickets 04 + 05) — the anonymous
 * `GET /market/movers`, `/market/indices`, `/market/indices/:id/series`,
 * and `/market/sectors` surfaces.
 *
 * Imports `DataModule` (DataSource for Postgres reads), `CacheModule`
 * (ReadCacheService for the class-2 read-through), and `RedisModule`
 * (REDIS_CLIENT for the class-3 intraday-Redis reads). Owns no schedule/worker
 * bits — those stay isolated in the ingestion worker (the cron-isolation rule).
 * The nightly ingest's `cache:market:` sweep is already registered
 * (free-tier-market-overview ticket 03's ReadCacheService.invalidateReadCaches
 * sweeps every READ_CACHE_PREFIXES entry including MARKET_CACHE_PREFIX).
 *
 * Binds {@link MARKET_CLOCK} — a `() => Date` provider, defaulting to the wall
 * clock — as the service's ONLY source of "now". `MarketService` resolves
 * during/outside-hours with `isMarketHours(this.clock())` rather than calling
 * `new Date()` or the static `IngestionScheduler.isMarketHours` directly, so
 * integration tests override one provider instead of spying on a static
 * method (which breaks the moment the service is constructed through a
 * different `TestingModule`-booted `MarketModule`).
 */

import { Module } from '@nestjs/common';
import { DataModule } from '../data/data.module';
import { CacheModule } from '../cache/cache.module';
import { RedisModule } from '../redis/redis.module';
import { MarketController } from './market.controller';
import { MarketService, MARKET_CLOCK } from './market.service';

@Module({
  imports: [DataModule, CacheModule, RedisModule],
  controllers: [MarketController],
  providers: [{ provide: MARKET_CLOCK, useValue: () => new Date() }, MarketService],
  exports: [MarketService],
})
export class MarketModule {}
