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
import { ListingBoard } from './enums';

/**
 * A curated IPO calendar row (spec 01, ticket 10). Manual entry.
 *
 * May be a non-ordinary-share IPO (REIT/ETF) even though such instruments are
 * outside the analysed universe — the calendar lists it as a plain row. Not
 * FK'd to {@link Company}/{@link Instrument}: the issuer may not exist in the
 * analysed universe yet at listing time.
 */
/**
 * Natural key (companyName, listingDate) so a re-ingest of the curated calendar
 * is an idempotent upsert (ticket 05). `NULLS NOT DISTINCT` (PG15+) in the
 * migration so a NULL (unknown) date still conflicts — an undated IPO row
 * re-ingests as an update, not a duplicate.
 */
@Entity({ name: 'ipo_listings' })
@Unique('UQ_ipo_listings_company_name_listing_date', [
  'companyName',
  'listingDate',
])
export class IpoListing {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', name: 'company_name', length: 256 })
  companyName!: string;

  /** Proposed board (may be LEAP / non-ordinary). */
  @Column({ type: 'enum', enum: ListingBoard, enumName: 'listing_board' })
  board!: ListingBoard;

  /** Expected/actual listing date. */
  @Index()
  @Column({ type: 'date', name: 'listing_date', nullable: true })
  listingDate!: string | null;

  /** Offer price per share (RM), if set. */
  @Column({ type: 'numeric', precision: 18, scale: 6, name: 'offer_price', nullable: true })
  offerPrice!: string | null;

  /** S3 key of the stored prospectus PDF (fed to the analyze-prospectus job, spec 06). */
  @Column({ type: 'varchar', name: 'prospectus_s3_key', length: 512, nullable: true })
  prospectusS3Key!: string | null;

  @ManyToOne(() => IngestionRun, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ingestion_run_id' })
  ingestionRun!: IngestionRun;

  @Index()
  @Column({ type: 'uuid', name: 'ingestion_run_id' })
  ingestionRunId!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
