import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { IngestionRun } from './ingestion-run.entity';

/**
 * Bursa's own sector/subsector classification (spec 01, ticket 10).
 *
 * Real public reference data (no vendor global taxonomy — the demo is KLSE-only),
 * modelled as a reference entity the {@link Company} FKs to. Carries `ingestionRunId`
 * like every sourced row (the `real` public-reference run).
 */
@Entity({ name: 'sectors' })
export class Sector {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Bursa sector name (e.g. `Financial Services`). Unique. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128 })
  name!: string;

  /** Optional finer subsector label. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  subsector!: string | null;

  @ManyToOne(() => IngestionRun, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ingestion_run_id' })
  ingestionRun!: IngestionRun;

  @Index()
  @Column({ type: 'uuid', name: 'ingestion_run_id' })
  ingestionRunId!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
