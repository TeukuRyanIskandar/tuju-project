/**
 * Free-tier domain model (spec 01) — barrel export.
 *
 * The shared relational model every other free-tier spec (02–06) reads. Provenance
 * is tracked as {@link IngestionRun} lineage (every sourced row FKs `ingestionRunId`),
 * not a per-row column, so the licence-boundary purge is a targeted delete.
 */
export * from './enums';
export * from './ingestion-run.entity';
export * from './synthetic-run.entity';
export * from './sector.entity';
export * from './company.entity';
export * from './instrument.entity';
export * from './price-bar.entity';
export * from './quarterly-financials.entity';
export * from './fundamentals-snapshot.entity';
export * from './indicator-snapshot.entity';
export * from './corporate-action.entity';
export * from './shariah-status.entity';
export * from './announcement.entity';
export * from './news-article.entity';
export * from './news-article-tag.entity';
export * from './ipo-listing.entity';
export * from './market-index.entity';
export * from './index-level.entity';
export * from './watchlist.entity';
export * from './watchlist-item.entity';
export * from './market-brief.entity';
export * from './prospectus-analysis.entity';
export * from './technical-analysis.entity';
export * from './fundamental-analysis.entity';

// Scaffold entity (pre-existing) — re-exported for a single import surface.
export * from './analysis-result.entity';

// Import all entities for the consolidated array
import { AnalysisResult } from './analysis-result.entity';
import { IngestionRun } from './ingestion-run.entity';
import { SyntheticRun } from './synthetic-run.entity';
import { Sector } from './sector.entity';
import { Company } from './company.entity';
import { Instrument } from './instrument.entity';
import { PriceBar } from './price-bar.entity';
import { QuarterlyFinancials } from './quarterly-financials.entity';
import { FundamentalsSnapshot } from './fundamentals-snapshot.entity';
import { IndicatorSnapshot } from './indicator-snapshot.entity';
import { CorporateAction } from './corporate-action.entity';
import { ShariahStatus } from './shariah-status.entity';
import { Announcement } from './announcement.entity';
import { NewsArticle } from './news-article.entity';
import { NewsArticleTag } from './news-article-tag.entity';
import { IpoListing } from './ipo-listing.entity';
import { MarketIndex } from './market-index.entity';
import { IndexLevel } from './index-level.entity';
import { Watchlist } from './watchlist.entity';
import { WatchlistItem } from './watchlist-item.entity';
import { MarketBrief } from './market-brief.entity';
import { ProspectusAnalysis } from './prospectus-analysis.entity';
import { TechnicalAnalysis } from './technical-analysis.entity';
import { FundamentalAnalysis } from './fundamental-analysis.entity';

// Consolidated for single-source-of-truth (M-01)
export const ENTITIES = [
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
];
