/**
 * Aggregator label → stable internal category mapping (spec 04 §1; ticket 01).
 *
 * Bursa's exact taxonomy is unreadable (the site 403s automated access), so
 * the stable internal `AnnouncementCategory` enum is the contract consumers
 * see; each source adapter maps its OWN raw labels onto it here. A later
 * licensed Bursa feed re-maps to the same enum with no consumer change.
 *
 * Matching is exact on the normalised label (trim, lowercase, single-spaced):
 * **no substring/prefix matching** — an unmapped label falls back to `OTHER`
 * so a row is never silently dropped.
 */

import { AnnouncementCategory } from '../entities/enums';

/** The demo aggregator's raw labels → internal categories. Exact match. */
const LABEL_MAP: Readonly<Record<string, AnnouncementCategory>> = {
  'quarterly report': AnnouncementCategory.FinancialResults,
  'financial results': AnnouncementCategory.FinancialResults,
  'results announcement': AnnouncementCategory.FinancialResults,
  dividend: AnnouncementCategory.Entitlement,
  entitlement: AnnouncementCategory.Entitlement,
  'entitlement notice': AnnouncementCategory.Entitlement,
  'dealing in listed shares by director': AnnouncementCategory.ShareholdingChange,
  'dealing in listed shares by substantial shareholder':
    AnnouncementCategory.ShareholdingChange,
  'notice of shares buy back': AnnouncementCategory.ShareholdingChange,
  'general announcement': AnnouncementCategory.General,
  'additional listing': AnnouncementCategory.AdditionalListing,
  'general meeting': AnnouncementCategory.Meeting,
  circular: AnnouncementCategory.Circular,
  'circular to shareholders': AnnouncementCategory.Circular,
  'annual report': AnnouncementCategory.AnnualReport,
  listing: AnnouncementCategory.Listing,
};

/** Normalise a raw label for matching: trim, lowercase, single-spaced. */
function normaliseLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Map one raw source label onto the stable internal enum. Unknown labels
 * resolve to `OTHER` — the adapter's fallback, never a dropped row.
 */
export function mapAnnouncementLabel(rawLabel: string): AnnouncementCategory {
  return LABEL_MAP[normaliseLabel(rawLabel)] ?? AnnouncementCategory.Other;
}
