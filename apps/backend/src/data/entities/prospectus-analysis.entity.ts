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
import { IpoListing } from './ipo-listing.entity';

/**
 * The Postgres index-of-record for a prospectus at-a-glance analysis (spec 06,
 * ticket 05) — the same claim-check shape as {@link MarketBrief} /
 * {@link AnalysisResult} (ADR-0004 §4): NestJS persists the S3 pointer + the
 * verdict-less headline here; the rich five-section artifact lives in S3.
 * Python never writes Postgres (ADR-0004 §2).
 *
 * One row per {@link IpoListing} (`prospectusId` is the listing id): a re-run
 * of the same curated IPO upserts in place. The row exists ONLY once a result
 * has landed, so "no row" is the explicit not-yet-processed predicate the
 * `enqueue-prospectus` ops command uses to bound AI cost. There is deliberately
 * no failure row: a terminally failed job leaves the listing eligible for the
 * next ops run.
 *
 * Provenance is always `real` (stored regulatory PDFs); it is served as a
 * constant rather than a column.
 */
@Entity({ name: 'prospectus_analyses' })
@Unique('UQ_prospectus_analyses_prospectus_id', ['prospectusId'])
export class ProspectusAnalysis {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The analysed {@link IpoListing} (its `id` is the job's `prospectusId`). */
  @ManyToOne(() => IpoListing, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'prospectus_id' })
  prospectus!: IpoListing;

  @Column({ type: 'uuid', name: 'prospectus_id' })
  prospectusId!: string;

  /** Client-facing correlation id (ADR-0007 §2). */
  @Index()
  @Column({ type: 'uuid', name: 'correlation_id' })
  correlationId!: string;

  /** The Python worker's own job id (`prospectus:{prospectusId}`). */
  @Index()
  @Column({ type: 'varchar', name: 'job_id', length: 255 })
  jobId!: string;

  /** Verdict-less thin summary headline (the "what to watch" line). */
  @Column({ type: 'text' })
  headline!: string;

  @Column({ type: 'timestamptz', name: 'as_of' })
  asOf!: Date;

  /** Claim-check pointer to the rich at-a-glance artifact (ADR-0004 §4). */
  @Column({ type: 'varchar', name: 'artifact_bucket', length: 255 })
  artifactBucket!: string;

  @Column({ type: 'varchar', name: 'artifact_key', length: 512 })
  artifactKey!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  /** Bumped on every re-run upsert (set explicitly by the store). */
  @Column({ type: 'timestamptz', name: 'updated_at', default: () => 'now()' })
  updatedAt!: Date;
}
