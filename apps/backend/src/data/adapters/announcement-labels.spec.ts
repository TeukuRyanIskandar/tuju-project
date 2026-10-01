/**
 * Categorisation tests (spec 04 "Testing decisions"; ticket 01): adapter
 * label → enum mapping, including unknown → `OTHER` (never a dropped row).
 */

import { AnnouncementCategory } from '../entities/enums';
import { mapAnnouncementLabel } from './announcement-labels';

describe('mapAnnouncementLabel (aggregator label → stable enum)', () => {
  it.each([
    ['Quarterly Report', AnnouncementCategory.FinancialResults],
    ['  financial   RESULTS ', AnnouncementCategory.FinancialResults],
    ['Dividend', AnnouncementCategory.Entitlement],
    ['Entitlement Notice', AnnouncementCategory.Entitlement],
    [
      'Dealing in Listed Shares by Director',
      AnnouncementCategory.ShareholdingChange,
    ],
    [
      'Dealing in Listed Shares by Substantial Shareholder',
      AnnouncementCategory.ShareholdingChange,
    ],
    ['Notice of Shares Buy Back', AnnouncementCategory.ShareholdingChange],
    ['General Announcement', AnnouncementCategory.General],
    ['Additional Listing', AnnouncementCategory.AdditionalListing],
    ['General Meeting', AnnouncementCategory.Meeting],
    ['Circular to Shareholders', AnnouncementCategory.Circular],
    ['Annual Report', AnnouncementCategory.AnnualReport],
    ['Listing', AnnouncementCategory.Listing],
  ])('maps %s → %s', (label, expected) => {
    expect(mapAnnouncementLabel(label)).toBe(expected);
  });

  it('maps an unknown label to OTHER (never a dropped row)', () => {
    expect(mapAnnouncementLabel('Market Update')).toBe(
      AnnouncementCategory.Other,
    );
    expect(mapAnnouncementLabel('Compliance: something new')).toBe(
      AnnouncementCategory.Other,
    );
  });

  it('does NOT substring-match a label onto a different category', () => {
    // 'Quarterly Report on capital structure' is not the quarterly-results
    // label — it must fall back to OTHER, not prefix-match onto results.
    expect(mapAnnouncementLabel('Quarterly Report on capital structure')).toBe(
      AnnouncementCategory.Other,
    );
  });
});
