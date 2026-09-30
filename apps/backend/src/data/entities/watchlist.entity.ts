import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { WatchlistItem } from './watchlist-item.entity';

/**
 * The one account-bound entity: `User → Watchlist → Instrument` (spec 01, ticket 10).
 *
 * `userId` references the session user (ADR-0005; sessions live in Redis, so there
 * is no `users` table to FK yet) — the account provisioning + limits behaviour is
 * deferred to the watchlist spec area. This ticket fixes only the entity shape so
 * downstream specs can reference it; it is **not** sourced data (no `ingestionRunId`).
 */
@Entity({ name: 'watchlists' })
export class Watchlist {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Owning session user id (ADR-0005). No FK — no persisted users table yet. */
  @Index()
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'varchar', length: 128, default: 'My Watchlist' })
  name!: string;

  @OneToMany(() => WatchlistItem, (item) => item.watchlist)
  items!: WatchlistItem[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
