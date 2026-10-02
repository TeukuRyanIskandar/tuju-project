import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * The Postgres index-of-record for the daily market brief (spec 06, ticket
 * 02) — the same claim-check shape as {@link AnalysisResult} (ADR-0004 §4):
 * NestJS persists the S3 pointer + verdict-less headline here; the fuller
 * narrative lives in S3. Python never writes Postgres (ADR-0004 §2).
 *
 * One row per `briefDate` (natural key): a same-day re-enqueue collapses to
 * the same BullMQ job (ADR-0007 §2), so a legitimate re-run upserts the row
 * in place rather than accumulating duplicates.
 */
@Entity({ name: 'market_briefs' })
@Unique('UQ_market_briefs_brief_date', ['briefDate'])
export class MarketBrief {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Client-facing correlation id (ADR-0007 §2). */
  @Index()
  @Column({ type: 'uuid', name: 'correlation_id' })
  correlationId!: string;

  /** The Python worker's own content-derived job id (`brief:YYYY-MM-DD`). */
  @Index()
  @Column({ type: 'varchar', name: 'job_id', length: 255 })
  jobId!: string;

  /** The calendar day this brief narrates, ISO `YYYY-MM-DD`. */
  @Column({ type: 'date', name: 'brief_date' })
  briefDate!: string;

  /** Verdict-less thin summary headline (ADR-0007 §5 `SystemSummary`). */
  @Column({ type: 'text' })
  headline!: string;

  @Column({ type: 'timestamptz', name: 'as_of' })
  asOf!: Date;

  /** Claim-check pointer to the fuller narrative (ADR-0004 §4). */
  @Column({ type: 'varchar', name: 'artifact_bucket', length: 255 })
  artifactBucket!: string;

  @Column({ type: 'varchar', name: 'artifact_key', length: 512 })
  artifactKey!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
