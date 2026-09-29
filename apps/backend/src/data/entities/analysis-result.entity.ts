import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * The one trivial entity that proves the TypeORM + Postgres wiring (ADR-0004).
 *
 * It is the Postgres index-of-record for an AI result (ADR-0004 §4 claim-check):
 * NestJS persists the S3 pointer + inline summary here; the full artifact lives
 * in S3. Python NEVER writes Postgres — NestJS is the sole writer (ADR-0004 §2).
 *
 * Only the columns needed to prove the wiring are modeled at scaffold time; the
 * full result schema is a feature-effort concern.
 */
@Entity({ name: 'analysis_results' })
export class AnalysisResult {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Client-facing correlation id (ADR-0007 §2). */
  @Index()
  @Column({ type: 'uuid', name: 'correlation_id' })
  correlationId!: string;

  /** Content-derived BullMQ job id (ADR-0007 §2). */
  @Index()
  @Column({ type: 'varchar', name: 'job_id', length: 255 })
  jobId!: string;

  /** Bursa ticker the analysis is anchored to. */
  @Column({ type: 'varchar', length: 64 })
  symbol!: string;

  /** Thin, stable verdict from the summary (ADR-0007 §5, Option A). */
  @Column({ type: 'varchar', length: 32 })
  verdict!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
