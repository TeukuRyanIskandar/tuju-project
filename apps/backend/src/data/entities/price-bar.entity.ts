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
import { Instrument } from './instrument.entity';

/**
 * A daily EOD price bar for an {@link Instrument} (spec 01).
 *
 * The 3-year synthetic backfill (~750 trading days) warms SMA-200; co-generated
 * with fundamentals from one {@link SyntheticRun} so every price-derived ratio
 * reconciles (decision A1). Intraday replay never lands here — it is Redis-only.
 *
 * `numeric` (not float) for prices so ratios computed downstream are exact.
 */
@Entity({ name: 'price_bars' })
@Unique('UQ_price_bars_instrument_date', ['instrumentId', 'tradeDate'])
export class PriceBar {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Instrument, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'instrument_id' })
  instrument!: Instrument;

  @Index()
  @Column({ type: 'uuid', name: 'instrument_id' })
  instrumentId!: string;

  /** Trading day (date only; no intraday timestamp). */
  @Index()
  @Column({ type: 'date', name: 'trade_date' })
  tradeDate!: string;

  @Column({ type: 'numeric', precision: 18, scale: 6 })
  open!: string;

  @Column({ type: 'numeric', precision: 18, scale: 6 })
  high!: string;

  @Column({ type: 'numeric', precision: 18, scale: 6 })
  low!: string;

  @Column({ type: 'numeric', precision: 18, scale: 6 })
  close!: string;

  @Column({ type: 'bigint' })
  volume!: string;

  @ManyToOne(() => IngestionRun, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ingestion_run_id' })
  ingestionRun!: IngestionRun;

  @Index()
  @Column({ type: 'uuid', name: 'ingestion_run_id' })
  ingestionRunId!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
