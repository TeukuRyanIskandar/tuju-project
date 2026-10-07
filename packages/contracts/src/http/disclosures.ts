import { z } from 'zod';
import {
  AnnouncementCategory,
  IsoDateTime,
  Page,
  provenanceShape,
} from './common.js';

/**
 * Market-wide announcements feed (spec 04): `GET /announcements`,
 * `GET /disclosures/dealings` (the same rows filtered to SHAREHOLDING_CHANGE)
 * and `GET /announcements/:id`.
 */

/** `stockCode` of the company's ordinary-share instrument (its natural key). */
export const CompanyCode = z.string();
export type CompanyCode = z.infer<typeof CompanyCode>;

export const MarketAnnouncementItem = z.strictObject({
  ...provenanceShape,
  companyCode: CompanyCode,
  companyName: z.string(),
  category: AnnouncementCategory,
  title: z.string(),
  filedAt: IsoDateTime,
  sourceUrl: z.string().nullable(),
  aiSummary: z.string().nullable(),
  aiSummaryAsOf: IsoDateTime.nullable(),
});
export type MarketAnnouncementItem = z.infer<typeof MarketAnnouncementItem>;

/** `GET /announcements/:id` — one announcement's own fields. */
export const AnnouncementDetail = MarketAnnouncementItem.extend({
  id: z.string(),
});
export type AnnouncementDetail = z.infer<typeof AnnouncementDetail>;

export const MarketAnnouncementsPage = Page(MarketAnnouncementItem);
export type MarketAnnouncementsPage = z.infer<typeof MarketAnnouncementsPage>;
