/**
 * Plain read-model DTOs the source-adapter seam emits (spec 01 "Source-adapter
 * seam"; ticket 02).
 *
 * Adapters return these plain objects — **never** TypeORM entity instances. The
 * ingestion worker (ticket 04) maps a DTO onto its entity and persists it,
 * stamping the `ingestionRunId` FK from the run it opened for the adapter's
 * {@link ProvenanceClass}. Keeping the seam in DTOs is what lets a later licensed
 * production adapter swap behind the same interface with no consumer change.
 *
 * DTO fields mirror the *source* fields of the corresponding entity (the columns
 * the adapter is responsible for; not the DB-managed `id`/`createdAt`/`ingestionRunId`).
 * Numeric values are carried as `number` (domain-natural); the worker stringifies
 * them for TypeORM's `numeric` columns at persist time.
 */
import type {
  AnnouncementCategory,
  CorporateActionType,
  ListingBoard,
  ShariahComplianceStatus,
} from '../entities/enums';

/**
 * A daily EOD price bar for one instrument, keyed by the instrument's Bursa
 * `stockCode` (the stable natural key the worker resolves to an `instrumentId`).
 * Shapes {@link PriceBar}.
 */
export interface PriceBarDto {
  /** Bursa 4-digit code the bar belongs to (resolved to instrument_id by the worker). */
  readonly stockCode: string;
  /** Trading day, ISO `YYYY-MM-DD`. */
  readonly tradeDate: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/**
 * Raw reported quarterly line items for one company, keyed by the company's
 * `stockCode` (resolved to `companyId` by the worker). Shapes {@link QuarterlyFinancials}.
 */
export interface QuarterlyFinancialsDto {
  readonly stockCode: string;
  readonly fiscalYear: number;
  /** Fiscal quarter 1–4. */
  readonly fiscalQuarter: number;
  /** Period end date, ISO `YYYY-MM-DD`. */
  readonly periodEnd: string;
  readonly revenue: number;
  readonly netProfit: number;
  readonly eps: number;
  readonly equity: number;
  readonly nta: number;
  readonly intangibles: number;
  readonly totalBorrowings: number;
}

/**
 * A co-generated fundamentals batch for one company: the shares-outstanding line
 * (held constant across the synthetic timeline, A1) plus the quarterly timeline.
 * The `MarketDataAdapter` and `FundamentalsAdapter` are co-generated from one seed,
 * so this shape is what {@link FundamentalsAdapter} yields per company.
 */
export interface FundamentalsDto {
  readonly stockCode: string;
  /** Shares outstanding, held constant across the synthetic timeline (A1). */
  readonly sharesOutstanding: number;
  /** The quarterly source-of-truth timeline (3-year backfill = 12 quarters). */
  readonly quarters: readonly QuarterlyFinancialsDto[];
}

/**
 * An official disclosure a company files with Bursa, keyed by `stockCode`.
 * Shapes {@link Announcement}. `sourceUrl` may be null; `aiSummary` is worker/AI-owned
 * and never set by the adapter.
 */
export interface AnnouncementDto {
  readonly stockCode: string;
  readonly category: AnnouncementCategory;
  readonly title: string;
  /** Filing timestamp. */
  readonly filedAt: Date;
  readonly sourceUrl: string | null;
}

/**
 * Third-party media coverage (headline + link only, no body). Shapes {@link NewsArticle}.
 * Tagging to companies is done in-house by the worker (spec 04), not the adapter.
 */
export interface NewsArticleDto {
  readonly headline: string;
  /** Canonical article URL (unique; makes RSS re-ingest idempotent). */
  readonly url: string;
  /** Publisher name (RSS feed title). */
  readonly source: string;
  readonly publishedAt: Date;
}

/**
 * A per-company Shariah-compliance record with an effective date. Shapes
 * {@link ShariahStatus}. Kept as history rows (SC's twice-yearly list).
 */
export interface ShariahStatusDto {
  readonly stockCode: string;
  readonly status: ShariahComplianceStatus;
  /** Date the verdict took effect, ISO `YYYY-MM-DD` (SC list publication date). */
  readonly effectiveDate: string;
}

/**
 * An announced entitlement / capital event. Shapes {@link CorporateAction}.
 * `amount` is null for action types that carry no cash amount.
 */
export interface CorporateActionDto {
  readonly stockCode: string;
  readonly type: CorporateActionType;
  /** Ex-date, ISO `YYYY-MM-DD` (calendar key + DY trailing-window anchor). */
  readonly exDate: string;
  readonly amount: number | null;
}

/**
 * A curated IPO calendar row (manual entry). Shapes {@link IpoListing}. Not FK'd
 * to a company/instrument — the issuer may not exist in the analysed universe yet.
 */
export interface IpoListingDto {
  readonly companyName: string;
  readonly board: ListingBoard;
  /** Expected/actual listing date, ISO `YYYY-MM-DD`, or null if unscheduled. */
  readonly listingDate: string | null;
  /** Offer price per share (RM), or null if unset. */
  readonly offerPrice: number | null;
  /** S3 key of the stored prospectus PDF, or null. */
  readonly prospectusS3Key: string | null;
}
