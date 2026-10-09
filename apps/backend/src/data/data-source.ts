import 'reflect-metadata';
import { DataSource } from 'typeorm';
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
  MarketBrief,
  MarketIndex,
  IndexLevel,
  NewsArticle,
  NewsArticleTag,
  PriceBar,
  ProspectusAnalysis,
  QuarterlyFinancials,
  Sector,
  ShariahStatus,
  SyntheticRun,
  TechnicalAnalysis,
  FundamentalAnalysis,
  Watchlist,
  WatchlistItem,
} from './entities';
import { InitialSchema1727600000000 } from './migrations/1727600000000-InitialSchema';
import { FreeTierDomainModel1727700000000 } from './migrations/1727700000000-FreeTierDomainModel';
import { ReIngestNaturalKeys1727800000000 } from './migrations/1727800000000-ReIngestNaturalKeys';
import { DisclosureReadModel1727900000000 } from './migrations/1727900000000-DisclosureReadModel';
import { MarketIndexModel1728000000000 } from './migrations/1728000000000-MarketIndexModel';
import { ShowcaseJobsModel1728100000000 } from './migrations/1728100000000-ShowcaseJobsModel';
import { ProspectusAnalysis1728200000000 } from './migrations/1728200000000-ProspectusAnalysis';
import { StockAnalyses1728300000000 } from './migrations/1728300000000-StockAnalyses';

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
  entities: [
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
    MarketIndex,
    IndexLevel,
    Watchlist,
    WatchlistItem,
    MarketBrief,
    ProspectusAnalysis,
    TechnicalAnalysis,
    FundamentalAnalysis,
  ],
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
});
