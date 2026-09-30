import { ChildEntity, Column } from 'typeorm';
import { IngestionRun } from './ingestion-run.entity';
import { IngestionRunKind } from './enums';

/**
 * A synthetic co-generation run (decision A1, spec 01).
 *
 * Carries the `seed` + generation `params` so the reconciled 3-year price +
 * fundamentals timeline it produces is one **regenerable, purgeable unit**: every
 * co-generated {@link PriceBar} and {@link QuarterlyFinancials}/{@link FundamentalsSnapshot}
 * row FKs to this run. Shares outstanding are held constant across the timeline
 * (trivial A1 reconciliation).
 *
 * STI child of {@link IngestionRun}; TypeORM stores it in the same table under
 * `kind = 'synthetic'`. Its `provenanceClass` is always `synthetic`.
 */
@ChildEntity(IngestionRunKind.Synthetic)
export class SyntheticRun extends IngestionRun {
  /** Deterministic seed the generator was run with (regenerates the exact timeline). */
  @Column({ type: 'bigint', name: 'seed' })
  seed!: string;

  /**
   * Opaque generation parameters (volatility, drift, intangibles ratio, etc.).
   * Kept as JSONB so the generator owns the shape without a schema migration.
   */
  @Column({ type: 'jsonb', name: 'params' })
  params!: Record<string, unknown>;
}
