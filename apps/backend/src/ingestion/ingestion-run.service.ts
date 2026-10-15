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

import { Injectable, Logger } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { SourceAdapter } from '../data/adapters/adapter.interfaces';
import { IngestionRun } from '../data/entities/ingestion-run.entity';
import { SyntheticRun } from '../data/entities/synthetic-run.entity';
import { IngestionRunKind, ProvenanceClass } from '../data/entities/enums';

/** What a landing step reports back to {@link IngestionRunService.run}. */
export interface Landed<T> {
  /** The step's own summary (row counts, DTOs later steps need, …). */
  readonly value: T;
  /** Per-item failures from the fetch(es) the step persisted (`SourceFetch.failures`). */
  readonly failures: readonly string[];
}

/** One completed ingestion run: its lineage id, the step's value, its failures. */
export interface RunOutcome<T> {
  readonly runId: string;
  readonly value: T;
  readonly failures: string[];
}

@Injectable()
export class IngestionRunService {
  private readonly logger = new Logger(IngestionRunService.name);

  /**
   * The Ingestion run module: open the run for `source` from the adapter's OWN
   * declaration (`adapterName` + `provenanceClass`; a {@link SyntheticRun} with
   * seed + params when it declares a `generation`), let `land` fetch and persist
   * every row FK'd to that run id, then record the fetch failures (an ops-visible
   * failure summary, correlated by run id). The caller never names an adapter or
   * chooses a run kind, so swapping the bound adapter re-stamps lineage for free.
   *
   * `manager` binds everything to the caller's transaction: a throwing `land`
   * rolls the run row back with the data.
   */
  async run<T>(
    manager: EntityManager,
    source: SourceAdapter,
    land: (runId: string) => Promise<Landed<T>>,
  ): Promise<RunOutcome<T>> {
    if (source.generation && source.provenanceClass !== ProvenanceClass.Synthetic) {
      throw new Error(
        `${source.adapterName} declares a seeded generation but provenance ${source.provenanceClass}`,
      );
    }
    const run = source.generation
      ? await this.openSyntheticRun(
          manager,
          source.adapterName,
          source.generation.seed,
          source.generation.params,
        )
      : await this.openRun(manager, source.adapterName, source.provenanceClass);
    const { value, failures } = await land(run.id);
    if (failures.length > 0) {
      this.logger.warn(
        {
          correlationId: run.id,
          adapter: source.adapterName,
          failures,
          msg: 'ingestion-run.failure-summary',
        },
        `${source.adapterName} failure summary (${failures.length}): ${failures.join('; ')}`,
      );
    }
    return { runId: run.id, value, failures: [...failures] };
  }

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
