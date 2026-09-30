/**
 * Ingestion-run lineage service (spec 01 "Provenance — lineage, not a per-row
 * marker"; ticket 04).
 *
 * Opens exactly one {@link IngestionRun} (or a {@link SyntheticRun} carrying the
 * seed + params) per ingest, so every sourced row can FK back to it. Provenance is
 * read via that lineage — never a per-row column — which is what makes the
 * decision-B purge a targeted delete and the read-time "illustrative" label a
 * single join.
 */

import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { IngestionRun } from '../data/entities/ingestion-run.entity';
import { SyntheticRun } from '../data/entities/synthetic-run.entity';
import { IngestionRunKind, ProvenanceClass } from '../data/entities/enums';

@Injectable()
export class IngestionRunService {
  /**
   * Open a standard ingestion run for an adapter's provenance class.
   * `manager` binds the insert to the caller's transaction.
   *
   * The base {@link IngestionRun} is the STI root; TypeORM would otherwise stamp
   * the discriminator with the class name, which is not a valid
   * {@link IngestionRunKind} enum label — so we set `kind = 'standard'` explicitly
   * on the insert (the entity is committed and must not be modified). The synthetic
   * child sets its own `'synthetic'` discriminator via `@ChildEntity`.
   */
  async openRun(
    manager: EntityManager,
    adapter: string,
    provenanceClass: ProvenanceClass,
  ): Promise<IngestionRun> {
    const ranAt = new Date();
    // Raw INSERT so TypeORM's single-table-inheritance mapping does not stamp the
    // discriminator with the class name (`"IngestionRun"`, an invalid
    // `ingestion_run_kind` enum label). We set `kind = 'standard'` directly; the
    // synthetic child uses its own `'synthetic'` discriminator via `@ChildEntity`.
    const rows = await manager.query(
      `INSERT INTO ingestion_runs (kind, adapter, provenance_class, ran_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [IngestionRunKind.Standard, adapter, provenanceClass, ranAt],
    );
    const id = rows[0].id as string;
    return manager.getRepository(IngestionRun).findOneByOrFail({ id });
  }

  /**
   * Open a synthetic co-generation run (STI child) carrying the seed + params, so
   * the reconciled timeline it produces is one regenerable, purgeable unit (A1).
   * Its `provenanceClass` is always `synthetic`.
   */
  async openSyntheticRun(
    manager: EntityManager,
    adapter: string,
    seed: number,
    params: Record<string, unknown>,
  ): Promise<SyntheticRun> {
    const repo = manager.getRepository(SyntheticRun);
    const run = repo.create({
      adapter,
      provenanceClass: ProvenanceClass.Synthetic,
      ranAt: new Date(),
      seed: seed.toString(),
      params,
    });
    return repo.save(run);
  }
}
