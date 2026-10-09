/**
 * Stock-page wire shapes. The single definition lives in `@tuju/contracts`
 * (ADR-0014); this module re-exports it so backend imports stay local.
 *
 * Type-only: the backend never imports contracts' runtime schemas in
 * production code (contracts is ESM; the backend is CommonJS).
 */

export type {
  AnnouncementItem,
  AnnouncementsPage,
  CorporateActionItem,
  CorporateActionsPage,
  FundamentalsBlock,
  IdentityBlock,
  ShariahBlock,
  StockCorePayload,
  StockFundamentalAnalysisResponse,
  StockSeriesPoint,
  StockSeriesResponse,
  StockTechnicalAnalysisResponse,
  TechnicalsBlock,
} from '@tuju/contracts';
