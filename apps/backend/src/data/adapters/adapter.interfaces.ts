/**
 * Source-adapter seam interfaces (spec 01 "Source-adapter seam"; ticket 02).
 *
 * One interface per data class. A consumer (the ingestion worker, ticket 04) reads
 * a stable read model of plain DTOs and never knows the producer, so a later
 * licensed production adapter (`EodhdMarketDataAdapter`, a licensed Bursa feed, …)
 * swaps behind the same interface by rebinding one DI provider — with no consumer
 * change.
 *
 * Every adapter self-reports its own name and the {@link ProvenanceClass} it
 * produces, so the Ingestion run module (`IngestionRunService.run`) opens the
 * correct {@link IngestionRun} from the adapter itself (the licence-boundary axis
 * that drives the decision-B purge and the read-time "illustrative" label) — the
 * worker never names or branches on a producer. Every fetch returns its rows AND
 * its per-item failures as data ({@link SourceFetch}); nothing is read back off
 * the adapter afterwards. Each interface has a matching injection token (adapters
 * have no runtime type at DI time), and the demo implementations are bound to
 * those tokens in `adapters.module.ts`.
 */
import type { ProvenanceClass } from '../entities/enums';
import type {
  AnnouncementDto,
  CorporateActionDto,
  DividendDto,
  FundamentalsDto,
  IndexLevelsDto,
  IpoListingDto,
  NewsArticleDto,
  PriceBarDto,
  ShariahStatusDto,
} from './dto';

/**
 * The seed + generation params of a seeded co-generation (decision A1). An
 * adapter that declares one gets a {@link SyntheticRun} (seed + params stamped)
 * instead of a standard run, so its rows are one regenerable, purgeable unit.
 */
export interface SyntheticGeneration {
  readonly seed: number;
  readonly params: Record<string, unknown>;
}

/**
 * Common contract every source adapter satisfies: it self-reports who it is and
 * which {@link ProvenanceClass} its rows carry, so the run that lineage-stamps
 * those rows is opened from the adapter's own declaration.
 */
export interface SourceAdapter {
  /** Stamped on `IngestionRun.adapter` (e.g. `SyntheticMarketDataAdapter`). Stable across releases: it is lineage. */
  readonly adapterName: string;
  /** The provenance class this adapter's rows belong to. */
  readonly provenanceClass: ProvenanceClass;
  /** Set only by a seeded co-generator; its run becomes a {@link SyntheticRun}. */
  readonly generation?: SyntheticGeneration;
}

/**
 * What one fetch returned: the rows to persist plus the ops-visible per-item
 * failures (`"1155: timeout"`) of a skip-and-continue source. `failures` is empty
 * when every item landed; a fetch that cannot produce anything throws instead.
 */
export interface SourceFetch<Row> {
  readonly rows: Row[];
  readonly failures: readonly string[];
}

/** A {@link SourceFetch} with no failures (every demo/static source). */
export function fetched<Row>(
  rows: Row[],
  failures: readonly string[] = [],
): SourceFetch<Row> {
  return { rows, failures };
}

/**
 * The analysed universe a market adapter serves (CONTEXT "Analysed universe").
 * `reference` is the curated demo set the synthetic generator covers;
 * `klci30` is the FBM KLCI 30 the PoC pulls (and fans TA/FA out over).
 */
export type MarketUniverse = 'reference' | 'klci30';

/**
 * EOD price bars for the analysed universe. Demo impl `SyntheticMarketDataAdapter`
 * (`synthetic`); production `EodhdMarketDataAdapter` (`real`).
 */
export interface MarketDataAdapter extends SourceAdapter {
  /** Which instruments the bars cover; the nightly ensures + materialises exactly these. */
  readonly universe: MarketUniverse;
  /** Fetch the daily EOD price bars to persist this run. */
  fetchDailyBars(): Promise<SourceFetch<PriceBarDto>>;
}
export const MARKET_DATA_ADAPTER = Symbol('MarketDataAdapter');

/**
 * Quarterly financials + shares outstanding, co-generated with prices from one seed
 * (A1). Demo impl synthetic (`synthetic`); production EODHD (`real`).
 */
export interface FundamentalsAdapter extends SourceAdapter {
  /** Fetch the per-company fundamentals (shares + quarterly timeline). */
  fetchFundamentals(): Promise<FundamentalsFetch>;
}

/**
 * A fundamentals fetch, optionally with the vendor's own dividend history.
 *
 * `dividends` absent → DY reads the dividend {@link CorporateActionDto}s (the
 * CONTEXT single source). Present (yfinance, even if empty) → DY reads these
 * instead. That is a known deviation from the single source, kept pending a
 * product decision (architecture-deepening ticket 05 Comments): the vendor
 * dividends are not persisted as corporate actions, so the calendar and DY
 * disagree on the yfinance path.
 */
export interface FundamentalsFetch extends SourceFetch<FundamentalsDto> {
  readonly dividends?: readonly DividendDto[];
}
export const FUNDAMENTALS_ADAPTER = Symbol('FundamentalsAdapter');

/**
 * Official Bursa disclosures. Demo impl `AggregatorDisclosureAdapter` (static
 * snapshot, `aggregator`); production a licensed Bursa feed (`real`).
 */
export interface DisclosureAdapter extends SourceAdapter {
  /** Fetch the disclosure snapshot to persist. */
  fetchAnnouncements(): Promise<SourceFetch<AnnouncementDto>>;
  /** Fetch corporate actions (single source for the calendar + DY ratio). */
  fetchCorporateActions(): Promise<SourceFetch<CorporateActionDto>>;
}
export const DISCLOSURE_ADAPTER = Symbol('DisclosureAdapter');

/**
 * Third-party media coverage. Demo impl `RssNewsAdapter` (headline + link,
 * `aggregator`); production RSS / licensed news.
 */
export interface NewsAdapter extends SourceAdapter {
  /** Fetch the latest news headlines (no bodies). */
  fetchHeadlines(): Promise<SourceFetch<NewsArticleDto>>;
}
export const NEWS_ADAPTER = Symbol('NewsAdapter');

/**
 * Per-company SC Shariah-compliance list. Demo impl `ManualShariahListAdapter`
 * (SC-PDF manual entry). Reference/manual data → `real` provenance (survives the
 * purge; it is public reference, not unlicensed vendor data).
 */
export interface ShariahListAdapter extends SourceAdapter {
  /** Fetch the current Shariah-status history rows. */
  fetchShariahStatuses(): Promise<SourceFetch<ShariahStatusDto>>;
}
export const SHARIAH_LIST_ADAPTER = Symbol('ShariahListAdapter');

/**
 * IPO calendar + prospectus references. Demo impl `ManualIpoAdapter` (manual
 * entry). Manual reference data → `real` provenance.
 */
export interface IpoAdapter extends SourceAdapter {
  /** Fetch the curated IPO calendar rows. */
  fetchIpoListings(): Promise<SourceFetch<IpoListingDto>>;
}
export const IPO_ADAPTER = Symbol('IpoAdapter');

/**
 * Cap-weighted index levels for the market overview (spec 05, ticket 02): the
 * headline index + one per Bursa Sector. Demo impl `SyntheticIndexAdapter`
 * (computes cap-weighted over the co-generated constituent bars, `synthetic`);
 * production `LicensedIndexAdapter` (ingests a licensed published level, `real`)
 * or a house recompute over real licensed prices — identical entities and
 * consumers either way, so going live is a provider rebind, not a rebuild.
 */
export interface IndexAdapter extends SourceAdapter {
  /** Fetch the index series to persist this run (one per index, with levels). */
  fetchIndexLevels(): Promise<SourceFetch<IndexLevelsDto>>;
}
export const INDEX_ADAPTER = Symbol('IndexAdapter');
