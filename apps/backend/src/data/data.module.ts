import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { AnalysisResult } from './entities/analysis-result.entity';
import {
  Announcement,
  Company,
  CorporateAction,
  FundamentalsSnapshot,
  IndicatorSnapshot,
  IngestionRun,
  Instrument,
  IpoListing,
  NewsArticle,
  NewsArticleTag,
  PriceBar,
  QuarterlyFinancials,
  Sector,
  ShariahStatus,
  SyntheticRun,
  Watchlist,
  WatchlistItem,
} from './entities';
import { InitialSchema1727600000000 } from './migrations/1727600000000-InitialSchema';
import { FreeTierDomainModel1727700000000 } from './migrations/1727700000000-FreeTierDomainModel';
import { ReIngestNaturalKeys1727800000000 } from './migrations/1727800000000-ReIngestNaturalKeys';

/**
 * All domain entities managed by the data layer. Registered in both this module
 * (runtime) and `data-source.ts` (CLI), which must stay in sync.
 */
const ENTITIES = [
  AnalysisResult,
  IngestionRun,
  SyntheticRun,
  Sector,
  Company,
  Instrument,
  PriceBar,
  QuarterlyFinancials,
  FundamentalsSnapshot,
  IndicatorSnapshot,
  CorporateAction,
  ShariahStatus,
  Announcement,
  NewsArticle,
  NewsArticleTag,
  IpoListing,
  Watchlist,
  WatchlistItem,
];

/**
 * Data layer (ADR-0004): Postgres + TypeORM via @nestjs/typeorm, reached by
 * DATABASE_URL (ADR-0006). NestJS is the sole Postgres writer.
 *
 * `synchronize` is OFF — schema is owned by explicit migrations. Entities are
 * registered here (not in packages/contracts): the DB schema and the
 * cross-language wire contract are distinct concerns (ADR-0004 §1).
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
        entities: ENTITIES,
        migrations: [
          InitialSchema1727600000000,
          FreeTierDomainModel1727700000000,
          ReIngestNaturalKeys1727800000000,
        ],
      }),
    }),
    TypeOrmModule.forFeature(ENTITIES),
  ],
  exports: [TypeOrmModule],
})
export class DataModule {}
