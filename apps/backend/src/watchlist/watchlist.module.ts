import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataModule } from '../data/data.module';
import { Watchlist } from '../data/entities/watchlist.entity';
import { WatchlistItem } from '../data/entities/watchlist-item.entity';

/**
 * Watchlist module (spec-03 extension, pending).
 *
 * Owns the Watchlist and WatchlistItem entities. Declared as a stub module
 * to reserve entity ownership as per Batch D: DataModule encapsulation.
 * The watchlist service and controllers will be added here when the feature
 * is fully specified and implemented.
 */
@Module({
  imports: [
    DataModule,
    TypeOrmModule.forFeature([Watchlist, WatchlistItem]),
  ],
})
export class WatchlistModule {}
