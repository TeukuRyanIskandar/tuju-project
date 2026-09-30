/**
 * Shared domain enums for the free-tier data model (spec 01).
 *
 * These are the stable internal vocabularies the source-adapter seam maps onto,
 * so a demo adapter and a later licensed feed both land on the same values with
 * no consumer change. Kept string-valued so the Postgres enum labels are legible.
 */

/**
 * Provenance class of an {@link IngestionRun} — the licence-boundary axis.
 * The decision-B purge deletes rows whose run is `synthetic` or `aggregator`;
 * `real` (public reference data) survives into production.
 */
export enum ProvenanceClass {
  Synthetic = 'synthetic',
  Aggregator = 'aggregator',
  Real = 'real',
}

/**
 * Single-table-inheritance discriminator for {@link IngestionRun}. A `synthetic`
 * kind is a {@link SyntheticRun} carrying the seed + generation params (A1).
 */
export enum IngestionRunKind {
  Standard = 'standard',
  Synthetic = 'synthetic',
}

/**
 * Stable internal classification of an {@link Announcement}. The aggregator adapter
 * maps its own labels onto this enum; a later licensed Bursa feed re-maps to the
 * same values. `SHAREHOLDING_CHANGE` is the dealings feed; `FINANCIAL_RESULTS`
 * feeds the (backward-looking) results calendar.
 */
export enum AnnouncementCategory {
  FinancialResults = 'FINANCIAL_RESULTS',
  Entitlement = 'ENTITLEMENT',
  ShareholdingChange = 'SHAREHOLDING_CHANGE',
  General = 'GENERAL',
  AdditionalListing = 'ADDITIONAL_LISTING',
  Meeting = 'MEETING',
  Circular = 'CIRCULAR',
  AnnualReport = 'ANNUAL_REPORT',
  Listing = 'LISTING',
  Other = 'OTHER',
}

/**
 * A capital/entitlement event. The single source for the corporate-actions calendar;
 * trailing-12-month `Dividend` actions feed the dividend-yield ratio.
 */
export enum CorporateActionType {
  Dividend = 'DIVIDEND',
  Bonus = 'BONUS',
  Split = 'SPLIT',
  Rights = 'RIGHTS',
}

/** SC Shariah-list compliance verdict, kept as a per-company history record. */
export enum ShariahComplianceStatus {
  Compliant = 'COMPLIANT',
  NonCompliant = 'NON_COMPLIANT',
}

/**
 * Listing board. The analysed universe is ordinary shares of `MAIN`/`ACE` only;
 * `LEAP` companies may appear as reference/IPO rows but are outside analysis.
 */
export enum ListingBoard {
  Main = 'MAIN',
  Ace = 'ACE',
  Leap = 'LEAP',
}
