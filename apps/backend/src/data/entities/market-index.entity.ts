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
import { IngestionRun } from './ingestion-run.entity';
import { MarketIndexKind } from './enums';
import { Sector } from './sector.entity';

/**
 * A reference entity naming an index the market overview surfaces (spec 05,
 * ticket 01): the FBM KLCI analogue `headline` index plus one index per Bursa
 * {@link Sector} (the `kind` discriminator, with the Sector FK on the sector
 * rows only).
 *
 * Membership is derived, NOT stored: headline = the whole analysed universe
 * (Main+ACE ordinary shares), a sector index = that Sector's instruments — so
 * there is deliberately no constituent join table. Natural key `(kind,
 * sectorId)` (NULLS NOT DISTINCT at the DB level) makes a re-ingest an
 * in-place upsert, per the re-ingest-idempotency lesson (free-tier-data 05).
 *
 * Carries {@link IngestionRun} lineage like every sourced row; whether the
 * level is computed or licensed is an adapter question (ticket 02), never a
 * shape question — production is the identical entity.
 */
@Entity({ name: 'market_indices' })
@Unique('UQ_market_indices_kind_sector', ['kind', 'sectorId'])
export class MarketIndex {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Headline vs per-Sector index (the discriminator, not a display label). */
  @Index()
  @Column({
    type: 'enum',
    enum: MarketIndexKind,
    enumName: 'market_index_kind',
    name: 'kind',
  })
  kind!: MarketIndexKind;

  /** Display name (e.g. the illustrative analogue, `Financial Services Index`). */
  @Column({ type: 'varchar', length: 128 })
  name!: string;

  /** The Sector this index scopes to; null on the headline row. */
  @ManyToOne(() => Sector, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'sector_id' })
  sector!: Sector | null;

  @Index()
  @Column({ type: 'uuid', name: 'sector_id', nullable: true })
  sectorId!: string | null;

  @ManyToOne(() => IngestionRun, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ingestion_run_id' })
  ingestionRun!: IngestionRun;

  @Index()
  @Column({ type: 'uuid', name: 'ingestion_run_id' })
  ingestionRunId!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
