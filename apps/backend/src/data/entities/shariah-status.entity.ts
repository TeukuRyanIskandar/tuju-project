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
import { ShariahComplianceStatus } from './enums';

/**
 * A per-{@link Company} Shariah-compliance record with an effective date
 * (spec 01, ticket 10). Kept as a small **history table** (SC's twice-yearly
 * list), not a mutable flag — the stock page shows the current value (latest
 * `effectiveDate`) with provenance.
 */
@Entity({ name: 'shariah_statuses' })
@Unique('UQ_shariah_statuses_company_effective', ['companyId', 'effectiveDate'])
export class ShariahStatus {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Company, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @Index()
  @Column({ type: 'uuid', name: 'company_id' })
  companyId!: string;

  @Column({ type: 'enum', enum: ShariahComplianceStatus, enumName: 'shariah_compliance_status' })
  status!: ShariahComplianceStatus;

  /** Date this compliance verdict took effect (SC list publication date). */
  @Index()
  @Column({ type: 'date', name: 'effective_date' })
  effectiveDate!: string;

  @ManyToOne(() => IngestionRun, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ingestion_run_id' })
  ingestionRun!: IngestionRun;

  @Index()
  @Column({ type: 'uuid', name: 'ingestion_run_id' })
  ingestionRunId!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
