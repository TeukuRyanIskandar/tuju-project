/**
 * Disclosure read-surface wire shapes (announcements, dealings, calendars,
 * news). The single definition lives in `@tuju/contracts` (ADR-0014); this
 * module re-exports it.
 */

export type {
  AnnouncementDetail,
  CompanyCode,
  CorporateActionCalendarItem,
  CorporateActionCalendarWindow,
  MarketAnnouncementItem,
  MarketAnnouncementsPage,
  NewsItem,
  NewsPage,
  ResultsCalendarItem,
  ResultsCalendarWindow,
} from '@tuju/contracts';
