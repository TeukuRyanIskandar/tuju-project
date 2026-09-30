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
import { Sector } from './sector.entity';
import { ListingBoard } from './enums';

/**
 * The listed issuer (spec 01, ticket 10).
 *
 * Distinct from the tradable line ({@link Instrument}); a company may issue more
 * than one instrument. Owns fundamentals, quarterly financials, announcements,
 * corporate actions and Shariah status. FKs the {@link Sector} reference.
 *
 * Carries a curated `aliases` list (feeds spec 04 news ticker-tagging: a
 * conservative whole-word match against `shortName`/`fullName`/`aliases`).
 */
@Entity({ name: 'companies' })
export class Company {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Full registered issuer name. */
  @Column({ type: 'varchar', name: 'full_name', length: 256 })
  fullName!: string;

  /** Listing board; analysed universe is `MAIN`/`ACE` ordinary shares only. */
  @Column({ type: 'enum', enum: ListingBoard, enumName: 'listing_board' })
  board!: ListingBoard;

  /** Curated aliases for deterministic news tagging (spec 04). */
  @Column({ type: 'text', array: true, default: '{}' })
  aliases!: string[];

  @ManyToOne(() => Sector, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'sector_id' })
  sector!: Sector;

  @Index()
  @Column({ type: 'uuid', name: 'sector_id' })
  sectorId!: string;

  @ManyToOne(() => IngestionRun, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ingestion_run_id' })
  ingestionRun!: IngestionRun;

  @Index()
  @Column({ type: 'uuid', name: 'ingestion_run_id' })
  ingestionRunId!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
