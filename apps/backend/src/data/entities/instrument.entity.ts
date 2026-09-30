import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Company } from './company.entity';
import { IngestionRun } from './ingestion-run.entity';

/**
 * A tradable listed line — an ordinary share (spec 01, ticket 10).
 *
 * Price bars and indicator snapshots attach here (not to {@link Company}). Keyed by
 * an internal id; `stockCode` (the stable Bursa 4-digit code) is the unique natural
 * key; `shortName`/`fullName` are mutable. FKs the issuing {@link Company}.
 *
 * The `short_name`/`full_name` columns get a `pg_trgm` GIN index (added in the
 * migration) so spec 02's fuzzy search is correct at demo *and* production scale.
 */
@Entity({ name: 'instruments' })
export class Instrument {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Stable Bursa 4-digit code (e.g. `1155`). Unique natural key. */
  @Index({ unique: true })
  @Column({ type: 'varchar', name: 'stock_code', length: 16 })
  stockCode!: string;

  /** Mutable short ticker name (e.g. `MAYBANK`). */
  @Column({ type: 'varchar', name: 'short_name', length: 64 })
  shortName!: string;

  /** Mutable full instrument name. */
  @Column({ type: 'varchar', name: 'full_name', length: 256 })
  fullName!: string;

  @ManyToOne(() => Company, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @Index()
  @Column({ type: 'uuid', name: 'company_id' })
  companyId!: string;

  @ManyToOne(() => IngestionRun, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ingestion_run_id' })
  ingestionRun!: IngestionRun;

  @Index()
  @Column({ type: 'uuid', name: 'ingestion_run_id' })
  ingestionRunId!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
