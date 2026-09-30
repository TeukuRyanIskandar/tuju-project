/**
 * Source-adapter seam interfaces (spec 01 "Source-adapter seam"; ticket 02).
 *
 * One interface per data class. A consumer (the ingestion worker, ticket 04) reads
 * a stable read model of plain DTOs and never knows the producer, so a later
 * licensed production adapter (`EodhdMarketDataAdapter`, a licensed Bursa feed, …)
 * swaps behind the same interface by rebinding one DI provider — with no consumer
 * change.
 *
 * Every adapter declares the {@link ProvenanceClass} it produces so the worker opens
 * the correct {@link IngestionRun} (the licence-boundary axis that drives the
 * decision-B purge and the read-time "illustrative" label). Each interface has a
 * matching injection token (adapters have no runtime type at DI time), and the demo
 * implementations are bound to those tokens in `adapters.module.ts`.
 */
import type { ProvenanceClass } from '../entities/enums';
import type {
  AnnouncementDto,
  CorporateActionDto,
  FundamentalsDto,
  IpoListingDto,
  NewsArticleDto,
  PriceBarDto,
  ShariahStatusDto,
} from './dto';

/**
 * Common contract every source adapter satisfies: it declares which
 * {@link ProvenanceClass} its rows carry so the worker opens the right run.
 */
export interface SourceAdapter {
  /** The provenance class this adapter's rows belong to. */
  readonly provenanceClass: ProvenanceClass;
}

/**
 * EOD price bars for the analysed universe. Demo impl `SyntheticMarketDataAdapter`
 * (`synthetic`); production `EodhdMarketDataAdapter` (`real`).
 */
export interface MarketDataAdapter extends SourceAdapter {
  /** Fetch the daily EOD price bars to persist this run. */
  fetchDailyBars(): Promise<PriceBarDto[]>;
}
export const MARKET_DATA_ADAPTER = Symbol('MarketDataAdapter');

/**
 * Quarterly financials + shares outstanding, co-generated with prices from one seed
 * (A1). Demo impl synthetic (`synthetic`); production EODHD (`real`).
 */
export interface FundamentalsAdapter extends SourceAdapter {
  /** Fetch the per-company fundamentals (shares + quarterly timeline). */
  fetchFundamentals(): Promise<FundamentalsDto[]>;
}
export const FUNDAMENTALS_ADAPTER = Symbol('FundamentalsAdapter');

/**
 * Official Bursa disclosures. Demo impl `AggregatorDisclosureAdapter` (static
 * snapshot, `aggregator`); production a licensed Bursa feed (`real`).
 */
export interface DisclosureAdapter extends SourceAdapter {
  /** Fetch the disclosure snapshot to persist. */
  fetchAnnouncements(): Promise<AnnouncementDto[]>;
  /** Fetch corporate actions (single source for the calendar + DY ratio). */
  fetchCorporateActions(): Promise<CorporateActionDto[]>;
}
export const DISCLOSURE_ADAPTER = Symbol('DisclosureAdapter');

/**
 * Third-party media coverage. Demo impl `RssNewsAdapter` (headline + link,
 * `aggregator`); production RSS / licensed news.
 */
export interface NewsAdapter extends SourceAdapter {
  /** Fetch the latest news headlines (no bodies). */
  fetchHeadlines(): Promise<NewsArticleDto[]>;
}
export const NEWS_ADAPTER = Symbol('NewsAdapter');

/**
 * Per-company SC Shariah-compliance list. Demo impl `ManualShariahListAdapter`
 * (SC-PDF manual entry). Reference/manual data → `real` provenance (survives the
 * purge; it is public reference, not unlicensed vendor data).
 */
export interface ShariahListAdapter extends SourceAdapter {
  /** Fetch the current Shariah-status history rows. */
  fetchShariahStatuses(): Promise<ShariahStatusDto[]>;
}
export const SHARIAH_LIST_ADAPTER = Symbol('ShariahListAdapter');

/**
 * IPO calendar + prospectus references. Demo impl `ManualIpoAdapter` (manual
 * entry). Manual reference data → `real` provenance.
 */
export interface IpoAdapter extends SourceAdapter {
  /** Fetch the curated IPO calendar rows. */
  fetchIpoListings(): Promise<IpoListingDto[]>;
}
export const IPO_ADAPTER = Symbol('IpoAdapter');
