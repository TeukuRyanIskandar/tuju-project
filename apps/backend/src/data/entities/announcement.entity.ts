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
import { Company } from './company.entity';
import { IngestionRun } from './ingestion-run.entity';
import { AnnouncementCategory } from './enums';

/**
 * An official disclosure a listed {@link Company} files with Bursa (spec 01;
 * behavioural detail owned by spec 04). Distinct from a {@link NewsArticle}.
 *
 * The source adapter maps its own labels onto the stable internal
 * {@link AnnouncementCategory} enum, so a demo aggregator snapshot and a later
 * licensed Bursa feed both land on the same categories with no consumer change.
 * Stores title/filedAt/sourceUrl only — **no attachment bodies** (Bursa detail 403s).
 *
 * Owns the `aiSummary` field: the ticket-05 announcement-summaries showcase and
 * ticket-09's prospectus effort write here (inherits `aggregator` provenance).
 */
/**
 * Natural key (company, filedAt, title) so a re-ingest of the same disclosure
 * snapshot is an idempotent upsert (ticket 05). `sourceUrl` is NOT the key: it
 * is nullable (the demo aggregator snapshot has none), and a licensed feed may
 * re-serve the same disclosure under a different URL.
 */
@Entity({ name: 'announcements' })
@Unique('UQ_announcements_company_filed_title', ['companyId', 'filedAt', 'title'])
export class Announcement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Company, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @Index()
  @Column({ type: 'uuid', name: 'company_id' })
  companyId!: string;

  @Index()
  @Column({ type: 'enum', enum: AnnouncementCategory, enumName: 'announcement_category' })
  category!: AnnouncementCategory;

  @Column({ type: 'varchar', length: 512 })
  title!: string;

  @Index()
  @Column({ type: 'timestamptz', name: 'filed_at' })
  filedAt!: Date;

  @Column({ type: 'varchar', name: 'source_url', length: 1024, nullable: true })
  sourceUrl!: string | null;

  /** System-generated AI summary (spec 04/06); null until generated. */
  @Column({ type: 'text', name: 'ai_summary', nullable: true })
  aiSummary!: string | null;

  @ManyToOne(() => IngestionRun, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ingestion_run_id' })
  ingestionRun!: IngestionRun;

  @Index()
  @Column({ type: 'uuid', name: 'ingestion_run_id' })
  ingestionRunId!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
