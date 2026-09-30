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
import { CorporateActionType } from './enums';

/**
 * An announced entitlement or capital event (spec 01, ticket 10).
 *
 * The single source for the corporate-actions calendar (keyed on `exDate`) and,
 * for `DIVIDEND` actions, the trailing-12-month dividend-yield ratio. Dividends
 * live here, never on {@link QuarterlyFinancials}.
 */
@Entity({ name: 'corporate_actions' })
export class CorporateAction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Company, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @Index()
  @Column({ type: 'uuid', name: 'company_id' })
  companyId!: string;

  @Column({ type: 'enum', enum: CorporateActionType, enumName: 'corporate_action_type' })
  type!: CorporateActionType;

  /** Ex-date — the calendar key and the DY trailing-window anchor. */
  @Index()
  @Column({ type: 'date', name: 'ex_date' })
  exDate!: string;

  /**
   * Per-share amount (dividend RM/share; ratio numerator for bonus/split/rights).
   * Nullable because not every action type carries a cash amount.
   */
  @Column({ type: 'numeric', precision: 18, scale: 6, nullable: true })
  amount!: string | null;

  @ManyToOne(() => IngestionRun, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ingestion_run_id' })
  ingestionRun!: IngestionRun;

  @Index()
  @Column({ type: 'uuid', name: 'ingestion_run_id' })
  ingestionRunId!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
