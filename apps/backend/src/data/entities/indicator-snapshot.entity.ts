import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Instrument } from './instrument.entity';
import { IngestionRun } from './ingestion-run.entity';

/**
 * One current row per {@link Instrument}, written nightly by the TS indicator step
 * (spec 01, ticket 07/10). Latest values only — **not** a stored series; chart
 * overlays recompute from {@link PriceBar}s on demand.
 *
 * 52-week high/low is a SQL window over the last 252 trading days, materialised here.
 * Computed in TypeScript (`trading-signals`) — deliberate override of TA-Lib-in-Python
 * (precision is meaningless on synthetic data; keeps demo ingestion one-language).
 */
@Entity({ name: 'indicator_snapshots' })
export class IndicatorSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** One current snapshot per instrument. */
  @OneToOne(() => Instrument, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'instrument_id' })
  instrument!: Instrument;

  @Index({ unique: true })
  @Column({ type: 'uuid', name: 'instrument_id' })
  instrumentId!: string;

  /** Latest close the indicators were computed against. */
  @Column({ type: 'numeric', precision: 18, scale: 6, name: 'latest_close' })
  latestClose!: string;

  @Column({ type: 'numeric', precision: 18, scale: 6, name: 'sma_20', nullable: true })
  sma20!: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 6, name: 'sma_50', nullable: true })
  sma50!: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 6, name: 'sma_200', nullable: true })
  sma200!: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 6, name: 'rsi_14', nullable: true })
  rsi14!: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 6, name: 'macd', nullable: true })
  macd!: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 6, name: 'macd_signal', nullable: true })
  macdSignal!: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 6, name: 'week52_high', nullable: true })
  week52High!: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 6, name: 'week52_low', nullable: true })
  week52Low!: string | null;

  @ManyToOne(() => IngestionRun, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ingestion_run_id' })
  ingestionRun!: IngestionRun;

  @Index()
  @Column({ type: 'uuid', name: 'ingestion_run_id' })
  ingestionRunId!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
