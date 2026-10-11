import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ENTITIES } from './entities';
import { InitialSchema1727600000000 } from './migrations/1727600000000-InitialSchema';
import { FreeTierDomainModel1727700000000 } from './migrations/1727700000000-FreeTierDomainModel';
import { ReIngestNaturalKeys1727800000000 } from './migrations/1727800000000-ReIngestNaturalKeys';
import { DisclosureReadModel1727900000000 } from './migrations/1727900000000-DisclosureReadModel';
import { MarketIndexModel1728000000000 } from './migrations/1728000000000-MarketIndexModel';
import { ShowcaseJobsModel1728100000000 } from './migrations/1728100000000-ShowcaseJobsModel';
import { ProspectusAnalysis1728200000000 } from './migrations/1728200000000-ProspectusAnalysis';
import { StockAnalyses1728300000000 } from './migrations/1728300000000-StockAnalyses';
import { AddSchemaDecorators1728350000000 } from './migrations/1728350000000-AddSchemaDecorators';

/**
 * Standalone TypeORM DataSource used by the CLI (migration:run/revert).
 *
 * Reached by DATABASE_URL (ADR-0006). `synchronize` is OFF — schema changes go
 * through explicit migrations only, keeping NestJS the deliberate, sole writer
 * of the schema as well as the data (ADR-0004 §2).
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  synchronize: false,
  logging: false,
  entities: ENTITIES,
  migrations: [
    InitialSchema1727600000000,
    FreeTierDomainModel1727700000000,
    ReIngestNaturalKeys1727800000000,
    DisclosureReadModel1727900000000,
    MarketIndexModel1728000000000,
    ShowcaseJobsModel1728100000000,
    ProspectusAnalysis1728200000000,
    StockAnalyses1728300000000,
    AddSchemaDecorators1728350000000,
  ],
});
