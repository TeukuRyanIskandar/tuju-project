import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { Company } from '../data/entities/company.entity';
import { Instrument } from '../data/entities/instrument.entity';
import { Sector } from '../data/entities/sector.entity';
import { ProvenanceClass } from '../data/entities/enums';
import { IngestionRunService } from './ingestion-run.service';
import { KLCI30_UNIVERSE } from './klci30-universe';
import type { ReferenceIds } from './reference-data.service';

export const KLCI_SEED_ADAPTER = 'Klci30UniverseSeedAdapter';

export interface KlciSeedResult {
  sectors: number;
  companies: number;
  instruments: number;
}

@Injectable()
export class KlciSeedService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly runs: IngestionRunService,
  ) {}

  async seedKlci(): Promise<KlciSeedResult> {
    return this.dataSource.transaction(async (manager) => {
      const ids = await this.upsertKlciUniverse(manager);
      return {
        sectors: new Set(KLCI30_UNIVERSE.map((r) => r.sectorName)).size,
        companies: ids.companyByStockCode.size,
        instruments: ids.instrumentByStockCode.size,
      };
    });
  }

  async upsertKlciUniverse(manager: EntityManager): Promise<ReferenceIds> {
    const run = await this.runs.openRun(
      manager,
      KLCI_SEED_ADAPTER,
      ProvenanceClass.Real,
    );

    const sectorRepo = manager.getRepository(Sector);
    const companyRepo = manager.getRepository(Company);
    const instrumentRepo = manager.getRepository(Instrument);

    const sectorNames = [...new Set(KLCI30_UNIVERSE.map((r) => r.sectorName))];
    const sectorByName = new Map<string, string>();
    for (const name of sectorNames) {
      let sector = await sectorRepo.findOne({ where: { name } });
      if (!sector) {
        sector = await sectorRepo.save(
          sectorRepo.create({
            name,
            subsector: null,
            ingestionRunId: run.id,
          }),
        );
      } else if (sector.ingestionRunId !== run.id) {
        sector.ingestionRunId = run.id;
        await sectorRepo.save(sector);
      }
      sectorByName.set(name, sector.id);
    }

    const companyByStockCode = new Map<string, string>();
    const instrumentByStockCode = new Map<string, string>();

    for (const ref of KLCI30_UNIVERSE) {
      const sectorId = sectorByName.get(ref.sectorName);
      if (!sectorId) {
        throw new Error(
          `upsertKlciUniverse: unknown sector ${ref.sectorName} for ${ref.stockCode}`,
        );
      }

      let instrument = await instrumentRepo.findOne({
        where: { stockCode: ref.stockCode },
      });

      if (instrument) {
        const company = await companyRepo.findOneOrFail({
          where: { id: instrument.companyId },
        });
        company.fullName = ref.fullName;
        company.board = ref.board;
        company.aliases = [...ref.aliases];
        company.sectorId = sectorId;
        company.ingestionRunId = run.id;
        await companyRepo.save(company);

        instrument.shortName = ref.shortName;
        instrument.fullName = ref.fullName;
        instrument.ingestionRunId = run.id;
        await instrumentRepo.save(instrument);

        companyByStockCode.set(ref.stockCode, company.id);
        instrumentByStockCode.set(ref.stockCode, instrument.id);
        continue;
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
