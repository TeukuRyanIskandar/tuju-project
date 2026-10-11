import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { StockAnalysisStatus } from './enums';
import { Instrument } from './instrument.entity';

@Entity({ name: 'technical_analyses' })
@Unique('UQ_technical_analyses_instrument_id', ['instrumentId'])
export class TechnicalAnalysis {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Instrument, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'instrument_id' })
  instrument!: Instrument;

   @Index()
   @Column({ type: 'uuid', name: 'instrument_id' })
   instrumentId!: string;

  @Column({
    type: 'enum',
    enum: StockAnalysisStatus,
    enumName: 'stock_analysis_status',
  })
  status!: StockAnalysisStatus;

  @Column({ type: 'text', nullable: true })
  headline!: string | null;

  @Column({ type: 'timestamptz', name: 'as_of', nullable: true })
  asOf!: Date | null;

  @Column({ type: 'varchar', name: 'artifact_bucket', length: 255, nullable: true })
  artifactBucket!: string | null;

  @Column({ type: 'varchar', name: 'artifact_key', length: 512, nullable: true })
  artifactKey!: string | null;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage!: string | null;

  @Index()
  @Column({ type: 'uuid', name: 'correlation_id' })
  correlationId!: string;

  @Index()
  @Column({ type: 'varchar', name: 'job_id', length: 255 })
  jobId!: string;

   @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
   createdAt!: Date;

   @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
   updatedAt!: Date;
}
