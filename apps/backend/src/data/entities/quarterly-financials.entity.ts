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

/**
 * The source-of-truth timeline of raw reported line items, per {@link Company} per
 * fiscal quarter (spec 01, ticket 10). YoY and consecutive-growth ratios are
 * computed across these rows; the 3-year backfill is 12 quarters.
 *
 * Dividends are NOT here — they are {@link CorporateAction}s (single source for
 * the calendar + DY). `numeric` for exact ratio reconciliation.
 */
@Entity({ name: 'quarterly_financials' })
@Unique('UQ_quarterly_financials_company_period', [
  'companyId',
  'fiscalYear',
  'fiscalQuarter',
])
export class QuarterlyFinancials {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Company, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @Index()
  @Column({ type: 'uuid', name: 'company_id' })
  companyId!: string;

  @Column({ type: 'int', name: 'fiscal_year' })
  fiscalYear!: number;

  /** Fiscal quarter 1–4. */
  @Column({ type: 'smallint', name: 'fiscal_quarter' })
  fiscalQuarter!: number;

  /** Period end date (for ordering / when-filed results calendar). */
  @Index()
  @Column({ type: 'date', name: 'period_end' })
  periodEnd!: string;

  @Column({ type: 'numeric', precision: 20, scale: 2 })
  revenue!: string;

  @Column({ type: 'numeric', precision: 20, scale: 2, name: 'net_profit' })
  netProfit!: string;

  /** Basic EPS for the quarter (may be negative for a loss-maker). */
  @Column({ type: 'numeric', precision: 18, scale: 6 })
  eps!: string;

  /** Total shareholders' equity at period end. */
  @Column({ type: 'numeric', precision: 20, scale: 2 })
  equity!: string;

  /** Net tangible assets at period end. */
  @Column({ type: 'numeric', precision: 20, scale: 2 })
  nta!: string;

  /** Intangible assets (co-generated so P/NTA ≠ P/B). */
  @Column({ type: 'numeric', precision: 20, scale: 2 })
  intangibles!: string;

  /** Interest-bearing borrowings at period end (feeds D/E). */
  @Column({ type: 'numeric', precision: 20, scale: 2, name: 'total_borrowings' })
  totalBorrowings!: string;

  @ManyToOne(() => IngestionRun, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ingestion_run_id' })
  ingestionRun!: IngestionRun;

  @Index()
  @Column({ type: 'uuid', name: 'ingestion_run_id' })
  ingestionRunId!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
