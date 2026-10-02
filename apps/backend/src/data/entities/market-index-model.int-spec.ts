/**
 * MarketIndex / IndexLevel schema integration test (spec 05, ticket 01;
 * ADR-0011).
 *
 * Exercised against REAL Postgres via testcontainers because what this ticket
 * decides is exactly what a mock silently gets wrong:
 *
 *   1. The additive migration runs cleanly up on the full chain (and the
 *      tables/constraints it creates match the entities).
 *   2. Re-ingest idempotency by construction: the natural-key upserts
 *      (`(kind, sectorId)` / `(index, date)`) update in place — one row,
 *      stable row id, lineage re-pointed to the fresh run (free-tier-data 05).
 *   3. `IndexLevel` rows are purgeable by lineage — the decision-B purge
 *      shape: schema-level FK to `IngestionRun` (RESTRICT blocks deleting the
 *      run first) + the `deleteByRun` delete works; `real` rows and the runs
 *      themselves survive. (The purge wiring is ticket 02.)
 *   4. The migration reverts cleanly down (last test — jest runs in order).
 *
 * Seeding is direct (NOT via the ingest) — same posture as the other int
 * specs; Docker is required (see `ingestion.int.spec.ts`).
 */

import { DataSource } from 'typeorm';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

import { InitialSchema1727600000000 } from '../migrations/1727600000000-InitialSchema';
import { FreeTierDomainModel1727700000000 } from '../migrations/1727700000000-FreeTierDomainModel';
import { ReIngestNaturalKeys1727800000000 } from '../migrations/1727800000000-ReIngestNaturalKeys';
import { DisclosureReadModel1727900000000 } from '../migrations/1727900000000-DisclosureReadModel';
import { MarketIndexModel1728000000000 } from '../migrations/1728000000000-MarketIndexModel';

import {
  IndexLevel,
  IngestionRun,
  MarketIndex,
  MarketIndexKind,
  ProvenanceClass,
  Sector,
} from './index';

jest.setTimeout(180_000);

/** Fixture dates (a stable recent window; date-only strings). */
const D1 = '2026-01-05';
const D2 = '2026-01-06';
const D3 = '2026-01-07';

describe('market index model migration + lineage (integration — testcontainers)', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let dataSource: DataSource;

  let realRefRun: IngestionRun;
  let licensedRun: IngestionRun;
  let syntheticRun1: IngestionRun;
  let syntheticRun2: IngestionRun;
  let sectorId: string;
  let headlineId: string;
  let sectorIndexId: string;

  beforeAll(async () => {
    pgContainer = await new PostgreSqlContainer('postgres:16-alpine').start();

    dataSource = new DataSource({
      type: 'postgres',
      url: pgContainer.getConnectionUri(),
      synchronize: false,
      entities: [IngestionRun, Sector, MarketIndex, IndexLevel],
      migrations: [
        InitialSchema1727600000000,
        FreeTierDomainModel1727700000000,
        ReIngestNaturalKeys1727800000000,
        DisclosureReadModel1727900000000,
        MarketIndexModel1728000000000,
      ],
    });
    // 1. The full chain, including this ticket's migration, runs cleanly up.
    await dataSource.initialize();
    await dataSource.runMigrations();

    await seedFixtures();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
    await pgContainer?.stop();
  });

  async function seedFixtures(): Promise<void> {
    // Raw INSERT for the runs — the STI discriminator footgun (repo.save
    // stamps `kind` with the class name, an invalid enum label) — same reason
    // as `IngestionRunService.openRun` and the disclosures int spec.
    const seedRun = async (
      adapter: string,
      provenanceClass: ProvenanceClass,
    ): Promise<IngestionRun> => {
      const rows = await dataSource.query(
        `INSERT INTO ingestion_runs (kind, adapter, provenance_class, ran_at)
         VALUES ('standard', $1, $2, $3)
         RETURNING id`,
        [adapter, provenanceClass, new Date()],
      );
      const id = rows[0].id as string;
      return dataSource.getRepository(IngestionRun).findOneByOrFail({ id });
    };
    // The production analogue: a licensed-feed run (real provenance).
    realRefRun = await seedRun('TestReferenceAdapter', ProvenanceClass.Real);
    licensedRun = await seedRun('LicensedIndexAdapter', ProvenanceClass.Real);
    syntheticRun1 = await seedRun(
      'SyntheticIndexAdapter',
      ProvenanceClass.Synthetic,
    );
    syntheticRun2 = await seedRun(
      'SyntheticIndexAdapter',
      ProvenanceClass.Synthetic,
    );

    // Sectors are real public reference data; the indices + levels are what
    // the demo's synthetic adapter would land (ticket 02 wires the real one).
    const sectorRepo = dataSource.getRepository(Sector);
    const sector = await sectorRepo.save(
      sectorRepo.create({
        name: 'Financial Services',
        ingestionRunId: realRefRun.id,
      }),
    );
    sectorId = sector.id;

    const indexRepo = dataSource.getRepository(MarketIndex);
    const headline = await indexRepo.save(
      indexRepo.create({
        kind: MarketIndexKind.Headline,
        name: 'Tuju Composite Index (illustrative)',
        sectorId: null,
        ingestionRunId: syntheticRun1.id,
      }),
    );
    const sectorIndex = await indexRepo.save(
      indexRepo.create({
        kind: MarketIndexKind.Sector,
        name: 'Financial Services Index (illustrative)',
        sectorId: sector.id,
        ingestionRunId: syntheticRun1.id,
      }),
    );
    headlineId = headline.id;
    sectorIndexId = sectorIndex.id;

    const levelRepo = dataSource.getRepository(IndexLevel);
    await levelRepo.save([
      levelRepo.create({
        indexId: headline.id,
        levelDate: D1,
        level: '1500.000000',
        ingestionRunId: syntheticRun1.id,
      }),
      levelRepo.create({
        indexId: headline.id,
        levelDate: D2,
        level: '1510.000000',
        ingestionRunId: syntheticRun1.id,
      }),
      levelRepo.create({
        indexId: sectorIndex.id,
        levelDate: D1,
        level: '5000.000000',
        ingestionRunId: syntheticRun1.id,
      }),
      // Real-provenance level survives the decision-B purge shape.
      levelRepo.create({
        indexId: headline.id,
        levelDate: D3,
        level: '1520.000000',
        ingestionRunId: licensedRun.id,
      }),
    ]);
  }

  it('seeds the headline + per-Sector index pair with levels', async () => {
    const indices = await dataSource.getRepository(MarketIndex).find({
      relations: { sector: true },
    });
    expect(indices).toHaveLength(2);

    const headline = indices.find((i) => i.id === headlineId)!;
    expect(headline.kind).toBe(MarketIndexKind.Headline);
    expect(headline.sectorId).toBeNull();

    const sectorIndex = indices.find((i) => i.id === sectorIndexId)!;
    expect(sectorIndex.kind).toBe(MarketIndexKind.Sector);
    expect(sectorIndex.sector!.name).toBe('Financial Services');

    expect(await dataSource.getRepository(IndexLevel).count()).toBe(4);
  });

  it('re-ingest upserts in place: one row, stable id, re-pointed lineage', async () => {
    const indexRepo = dataSource.getRepository(MarketIndex);
    const levelRepo = dataSource.getRepository(IndexLevel);

    // MarketIndex re-ingest: same (kind, sectorId), refreshed name + lineage.
    await indexRepo.upsert(
      indexRepo.create({
        kind: MarketIndexKind.Headline,
        name: 'Tuju Composite Index (illustrative, re-ingested)',
        sectorId: null,
        ingestionRunId: syntheticRun2.id,
      }),
      ['kind', 'sectorId'],
    );
    const headlineAgain = await indexRepo.findOne({
      where: { kind: MarketIndexKind.Headline },
    });
    expect(headlineAgain).toBeDefined();
    expect(headlineAgain!.id).toBe(headlineId); // stable row id
    expect(headlineAgain!.ingestionRunId).toBe(syntheticRun2.id);
    expect(await indexRepo.count()).toBe(2); // no duplicate row

    // IndexLevel re-ingest: same (index, date), refreshed level + lineage.
    await levelRepo.upsert(
      levelRepo.create({
        indexId: headlineId,
        levelDate: D1,
        level: '1555.000000',
        ingestionRunId: syntheticRun2.id,
      }),
      ['indexId', 'levelDate'],
    );
    const d1 = await levelRepo.findOne({
      where: { indexId: headlineId, levelDate: D1 },
    });
    expect(d1).toBeDefined();
    expect(d1!.level).toBe('1555.000000');
    expect(d1!.ingestionRunId).toBe(syntheticRun2.id); // lineage re-pointed
    // Still exactly one row for (headline, D1) — and 4 total, no duplicates.
    expect(
      await levelRepo.count({
        where: { indexId: headlineId, levelDate: D1 },
      }),
    ).toBe(1);
    expect(await levelRepo.count()).toBe(4);
  });

  it('IndexLevel rows are purgeable by lineage (decision-B purge shape)', async () => {
    const runRepo = dataSource.getRepository(IngestionRun);
    const levelRepo = dataSource.getRepository(IndexLevel);

    // Schema-level FK first: RESTRICT blocks deleting the run its levels FK.
    await expect(
      runRepo.delete([syntheticRun1.id, syntheticRun2.id]),
    ).rejects.toThrow();

    // Same policy on the Sector FK (the Company→Sector precedent): a Sector is
    // real reference data — deleting one must not cascade away an index and
    // its chartable level history.
    await expect(dataSource.getRepository(Sector).delete(sectorId)).rejects
      .toThrow();

    // The purge deletes rows by lineage (PurgeService.deleteByRun shape),
    // runs-preserved: exactly the synthetic-run levels go, real stays.
    const syntheticRunIds = [syntheticRun1.id, syntheticRun2.id];
    const res = await levelRepo
      .createQueryBuilder()
      .delete()
      .where('ingestion_run_id IN (:...runIds)', { runIds: syntheticRunIds })
      .execute();
    expect(res.affected).toBe(3); // (headline,D1)+(headline,D2)+(sector,D1)

    const survivors = await levelRepo.find({ order: { levelDate: 'ASC' } });
    expect(survivors).toHaveLength(1); // the licensed-feed (real) level
    expect(survivors[0].levelDate).toBe(D3);
    expect(survivors[0].ingestionRunId).toBe(licensedRun.id);

    // Lineage itself survives the purge (decision B).
    expect(await runRepo.count()).toBe(4);
  });

  it('the migration reverts cleanly down (last test — order matters)', async () => {
    // Catalog probes: true while applied. (Row-count check, not Boolean() —
    // an empty result array is truthy.)
    const tableExists = async (relname: string): Promise<boolean> =>
      (await dataSource.query('SELECT 1 FROM pg_class WHERE relname = $1', [
        relname,
      ])).length > 0;
    const typeExists = async (typname: string): Promise<boolean> =>
      (await dataSource.query('SELECT 1 FROM pg_type WHERE typname = $1', [
        typname,
      ])).length > 0;

    // Tables + type exist while the migration is applied.
    expect(await tableExists('market_indices')).toBe(true);
    expect(await tableExists('index_levels')).toBe(true);
    expect(await typeExists('market_index_kind')).toBe(true);

    await dataSource.undoLastMigration();

    expect(await tableExists('market_indices')).toBe(false);
    expect(await tableExists('index_levels')).toBe(false);
    expect(await typeExists('market_index_kind')).toBe(false);
  });
});
