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
import { MarketIndex } from './market-index.entity';

/**
 * One cap-weighted level for a {@link MarketIndex} on a given day (spec 05,
 * ticket 01) — the daily time series parallel to price bars, so an index is
 * chartable. The live intraday level is Redis-only (class 3) and never lands
 * here; this table is the EOD-derived class-2 series.
 *
 * Natural key `(index, date)` upsert (free-tier-data 05 lesson): a re-ingest
 * updates the level in place — stable row ids, lineage re-points to the fresh
 * run. Provenance is the {@link IngestionRun} lineage FK (lineage, not a
 * per-row marker), so a synthetic run's levels are purgeable by run
 * (decision B) and surface "illustrative" via the run join.
 */
@Entity({ name: 'index_levels' })
@Unique('UQ_index_levels_index_date', ['indexId', 'levelDate'])
export class IndexLevel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => MarketIndex, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'index_id' })
  marketIndex!: MarketIndex;

  @Index()
  @Column({ type: 'uuid', name: 'index_id' })
  indexId!: string;

  /** Trading day the level settles (date only; no intraday timestamp). */
  @Index()
  @Column({ type: 'date', name: 'level_date' })
  levelDate!: string;

  /** The index level (numeric for exactness, like every price column). */
  @Column({ type: 'numeric', precision: 18, scale: 6 })
  level!: string;

  @ManyToOne(() => IngestionRun, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ingestion_run_id' })
  ingestionRun!: IngestionRun;

  @Index()
  @Column({ type: 'uuid', name: 'ingestion_run_id' })
  ingestionRunId!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
