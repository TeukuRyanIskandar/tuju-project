import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Company } from './company.entity';
import { IngestionRun } from './ingestion-run.entity';

/**
 * Derived per-{@link Company} latest rollup the stock page and screener read cheaply
 * (spec 01, ticket 10). Recomputed after each quarterly ingest.
 *
 * Ratios are **materialised here, not computed at query time** — defined once so
 * screener and stock page agree (ticket 10 ratio definitions). `null` ratios use
 * SQL NULL semantics (e.g. loss-maker P/E is null and excluded from any P/E band).
 * The actual computation logic lives with the ingest ticket; this is the shape.
 */
@Entity({ name: 'fundamentals_snapshots' })
export class FundamentalsSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** One current snapshot per company. */
  @OneToOne(() => Company, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @Index({ unique: true })
  @Column({ type: 'uuid', name: 'company_id' })
  companyId!: string;

  /** Shares outstanding (held constant across the synthetic timeline, A1). */
  @Column({ type: 'bigint', name: 'shares_outstanding' })
  sharesOutstanding!: string;

  /** Latest NTA/share (equity − intangibles) ÷ shares. */
  @Column({ type: 'numeric', precision: 18, scale: 6, name: 'nta_per_share' })
  ntaPerShare!: string;

  /** TTM earnings per share (sum of last 4 quarters). */
  @Column({ type: 'numeric', precision: 18, scale: 6, name: 'ttm_eps' })
  ttmEps!: string;

  /** TTM revenue. */
  @Column({ type: 'numeric', precision: 20, scale: 2, name: 'ttm_revenue' })
  ttmRevenue!: string;

  /** TTM net profit. */
  @Column({ type: 'numeric', precision: 20, scale: 2, name: 'ttm_net_profit' })
  ttmNetProfit!: string;

  /** P/E — null when TTM EPS ≤ 0 (loss-making; no negative P/E). */
  @Column({ type: 'numeric', precision: 18, scale: 6, name: 'pe_ratio', nullable: true })
  peRatio!: string | null;

  /** Dividend yield — trailing-12-month dividend per share ÷ price. */
  @Column({ type: 'numeric', precision: 18, scale: 6, name: 'dividend_yield', nullable: true })
  dividendYield!: string | null;

  /** Price ÷ NTA per share. */
  @Column({ type: 'numeric', precision: 18, scale: 6, name: 'pnta_ratio', nullable: true })
  pntaRatio!: string | null;

  /** Return on average equity (TTM net profit ÷ average equity). */
  @Column({ type: 'numeric', precision: 18, scale: 6, name: 'roe', nullable: true })
  roe!: string | null;

  /** Debt-to-equity — total borrowings ÷ latest equity. */
  @Column({ type: 'numeric', precision: 18, scale: 6, name: 'debt_to_equity', nullable: true })
  debtToEquity!: string | null;

  /** Price-to-sales — market cap ÷ TTM revenue. */
  @Column({ type: 'numeric', precision: 18, scale: 6, name: 'psr', nullable: true })
  psr!: string | null;

  /** Count of consecutive quarters of positive YoY net-profit growth. */
  @Column({ type: 'int', name: 'consecutive_growth_quarters', default: 0 })
  consecutiveGrowthQuarters!: number;

  @ManyToOne(() => IngestionRun, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ingestion_run_id' })
  ingestionRun!: IngestionRun;

  @Index()
  @Column({ type: 'uuid', name: 'ingestion_run_id' })
  ingestionRunId!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
