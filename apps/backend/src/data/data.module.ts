import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { InitialSchema1727600000000 } from './migrations/1727600000000-InitialSchema';
import { FreeTierDomainModel1727700000000 } from './migrations/1727700000000-FreeTierDomainModel';
import { ReIngestNaturalKeys1727800000000 } from './migrations/1727800000000-ReIngestNaturalKeys';
import { DisclosureReadModel1727900000000 } from './migrations/1727900000000-DisclosureReadModel';
import { MarketIndexModel1728000000000 } from './migrations/1728000000000-MarketIndexModel';
import { ShowcaseJobsModel1728100000000 } from './migrations/1728100000000-ShowcaseJobsModel';
import { ProspectusAnalysis1728200000000 } from './migrations/1728200000000-ProspectusAnalysis';
import { StockAnalyses1728300000000 } from './migrations/1728300000000-StockAnalyses';

/**
 * Data layer (ADR-0004): Postgres + TypeORM via @nestjs/typeorm, reached by
 * DATABASE_URL (ADR-0006). NestJS is the sole Postgres writer.
 *
 * `synchronize` is OFF — schema is owned by explicit migrations. Database
 * connection setup is managed here. Entity registration is now per-feature
 * module via TypeOrmModule.forFeature() declarations — each feature owns
 * and declares the entities it needs (Batch D: DataModule encapsulation).
 * See `data-source.ts` (CLI migrations) for the consolidated ENTITIES array.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        type: 'postgres' as const,
        url: config.databaseUrl,
        synchronize: false,
        autoLoadEntities: true,
        migrations: [
          InitialSchema1727600000000,
          FreeTierDomainModel1727700000000,
          ReIngestNaturalKeys1727800000000,
          DisclosureReadModel1727900000000,
          MarketIndexModel1728000000000,
          ShowcaseJobsModel1728100000000,
          ProspectusAnalysis1728200000000,
          StockAnalyses1728300000000,
        ],
      }),
    }),
  ],
  exports: [TypeOrmModule],
})
export class DataModule {}
