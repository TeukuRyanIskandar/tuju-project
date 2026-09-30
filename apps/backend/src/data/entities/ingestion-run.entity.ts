import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  TableInheritance,
} from 'typeorm';
import { IngestionRunKind, ProvenanceClass } from './enums';

/**
 * Provenance lineage root (spec 01, ticket 10 decision).
 *
 * A single write of sourced data by one adapter. Records the adapter and its
 * **provenance class** (`synthetic`/`aggregator`/`real`). Every sourced row carries
 * an `ingestionRunId` FK back here; provenance is read via that lineage, NOT a
 * per-row marker. The read-time "illustrative" label is a join to the run.
 *
 * The **decision-B purge** deletes rows whose run is `synthetic`/`aggregator`,
 * leaving `real` reference data and the lineage itself intact into production.
 *
 * Single-table inheritance: {@link SyntheticRun} is the `synthetic` kind carrying
 * the seed + generation params (decision A1 co-generation).
 */
@Entity({ name: 'ingestion_runs' })
@TableInheritance({
  column: { type: 'enum', enum: IngestionRunKind, enumName: 'ingestion_run_kind', name: 'kind' },
})
export class IngestionRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Identifier of the adapter that produced this run (e.g. `SyntheticMarketDataAdapter`). */
  @Column({ type: 'varchar', length: 128 })
  adapter!: string;

  /** Licence-boundary axis; drives the decision-B purge and the illustrative label. */
  @Index()
  @Column({
    type: 'enum',
    enum: ProvenanceClass,
    enumName: 'provenance_class',
    name: 'provenance_class',
  })
  provenanceClass!: ProvenanceClass;

  /** When the ingest ran (adapter wall-clock), distinct from row `createdAt`. */
  @Column({ type: 'timestamptz', name: 'ran_at' })
  ranAt!: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
