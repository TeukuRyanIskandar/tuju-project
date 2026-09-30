/**
 * Reference-universe seeding (spec 01, ticket 04).
 *
 * Idempotently ensures the `real`-provenance reference rows exist — Bursa sectors,
 * listed {@link Company}s and their ordinary-share {@link Instrument}s — under a
 * single public-reference {@link IngestionRun}. Reference entities are `real`
 * (public reference data), so they survive the decision-B purge; the synthetic
 * price/fundamentals rows that FK the instruments are what gets purged.
 *
 * Keyed on the stable natural keys (`Sector.name`, `Instrument.stockCode`) so a
 * re-run is a no-op — the nightly ingest can call this every night safely.
 */

import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { Company } from '../data/entities/company.entity';
import { Instrument } from '../data/entities/instrument.entity';
import { Sector } from '../data/entities/sector.entity';
import { ProvenanceClass } from '../data/entities/enums';
import { IngestionRunService } from './ingestion-run.service';
import { REFERENCE_SECTORS, REFERENCE_UNIVERSE } from './reference-universe';

/** Resolved id maps after seeding, so callers can FK sourced rows. */
export interface ReferenceIds {
  /** stockCode → instrumentId. */
  instrumentByStockCode: Map<string, string>;
  /** stockCode → companyId. */
  companyByStockCode: Map<string, string>;
}

@Injectable()
export class ReferenceDataService {
  constructor(private readonly runs: IngestionRunService) {}

  /**
   * Ensure sectors/companies/instruments exist, returning the id maps. Opens (or
   * reuses conceptually — always opens a fresh lineage row, cheap) a `real` run
   * for any rows it inserts. Idempotent on the natural keys.
   */
  async ensureReferenceData(manager: EntityManager): Promise<ReferenceIds> {
    const run = await this.runs.openRun(
      manager,
      'PublicReferenceAdapter',
      ProvenanceClass.Real,
    );

    const sectorRepo = manager.getRepository(Sector);
    const companyRepo = manager.getRepository(Company);
    const instrumentRepo = manager.getRepository(Instrument);

    // Sectors.
    const sectorByName = new Map<string, string>();
    for (const name of REFERENCE_SECTORS) {
      let sector = await sectorRepo.findOne({ where: { name } });
      if (!sector) {
        sector = await sectorRepo.save(
          sectorRepo.create({
            name,
            subsector: null,
            ingestionRunId: run.id,
          }),
        );
      }
      sectorByName.set(name, sector.id);
    }

    // Companies + instruments.
    const companyByStockCode = new Map<string, string>();
    const instrumentByStockCode = new Map<string, string>();
    for (const ref of REFERENCE_UNIVERSE) {
      let instrument = await instrumentRepo.findOne({
        where: { stockCode: ref.stockCode },
      });
      if (instrument) {
        companyByStockCode.set(ref.stockCode, instrument.companyId);
        instrumentByStockCode.set(ref.stockCode, instrument.id);
        continue;
      }

      const sectorId = sectorByName.get(ref.sectorName);
      if (!sectorId) {
        throw new Error(
          `ensureReferenceData: unknown sector ${ref.sectorName} for ${ref.stockCode}`,
        );
      }

      const company = await companyRepo.save(
        companyRepo.create({
          fullName: ref.fullName,
          board: ref.board,
          aliases: [...ref.aliases],
          sectorId,
          ingestionRunId: run.id,
        }),
      );
      instrument = await instrumentRepo.save(
        instrumentRepo.create({
          stockCode: ref.stockCode,
          shortName: ref.shortName,
          fullName: ref.fullName,
          companyId: company.id,
          ingestionRunId: run.id,
        }),
      );

      companyByStockCode.set(ref.stockCode, company.id);
      instrumentByStockCode.set(ref.stockCode, instrument.id);
    }

    return { instrumentByStockCode, companyByStockCode };
  }
}
