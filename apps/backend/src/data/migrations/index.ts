import { InitialSchema1727600000000 } from './1727600000000-InitialSchema';
import { FreeTierDomainModel1727700000000 } from './1727700000000-FreeTierDomainModel';
import { ReIngestNaturalKeys1727800000000 } from './1727800000000-ReIngestNaturalKeys';
import { DisclosureReadModel1727900000000 } from './1727900000000-DisclosureReadModel';
import { MarketIndexModel1728000000000 } from './1728000000000-MarketIndexModel';
import { ShowcaseJobsModel1728100000000 } from './1728100000000-ShowcaseJobsModel';
import { ProspectusAnalysis1728200000000 } from './1728200000000-ProspectusAnalysis';
import { StockAnalyses1728300000000 } from './1728300000000-StockAnalyses';
import { AddSchemaDecorators1728350000000 } from './1728350000000-AddSchemaDecorators';

/**
 * The ordered migration list, shared by the CLI DataSource (`data-source.ts`)
 * and the NestJS connection (`data.module.ts`) so the two cannot drift.
 */
export const MIGRATIONS = [
  InitialSchema1727600000000,
  FreeTierDomainModel1727700000000,
  ReIngestNaturalKeys1727800000000,
  DisclosureReadModel1727900000000,
  MarketIndexModel1728000000000,
  ShowcaseJobsModel1728100000000,
  ProspectusAnalysis1728200000000,
  StockAnalyses1728300000000,
  AddSchemaDecorators1728350000000,
];
