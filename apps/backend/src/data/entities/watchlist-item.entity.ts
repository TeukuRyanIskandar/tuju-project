import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Instrument } from './instrument.entity';
import { Watchlist } from './watchlist.entity';

/**
 * A single {@link Instrument} on a {@link Watchlist} (spec 01, ticket 10).
 *
 * Explicit join entity (so an item can later carry ordering / added-at metadata).
 * Unique per (watchlist, instrument) so the same instrument can't be added twice.
 */
@Entity({ name: 'watchlist_items' })
@Unique('UQ_watchlist_items_watchlist_instrument', ['watchlistId', 'instrumentId'])
export class WatchlistItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Watchlist, (watchlist) => watchlist.items, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'watchlist_id' })
  watchlist!: Watchlist;

  @Index()
  @Column({ type: 'uuid', name: 'watchlist_id' })
  watchlistId!: string;

  @ManyToOne(() => Instrument, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'instrument_id' })
  instrument!: Instrument;

  @Index()
  @Column({ type: 'uuid', name: 'instrument_id' })
  instrumentId!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
