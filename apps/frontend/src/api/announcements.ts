import { queryOptions } from '@tanstack/react-query'
import {
  AnnouncementDetail,
  MarketAnnouncementsPage,
  type AnnouncementCategory,
} from '@tuju/contracts'
import { apiGet, withQuery } from '../lib/api'
import { csv, type DateRangeParams, type PageParams } from './params'

export interface AnnouncementsParams extends PageParams, DateRangeParams {
  category?: readonly AnnouncementCategory[]
  companyCode?: string
}

/** Dealings is the same feed fixed to SHAREHOLDING_CHANGE, so it has no `category`. */
export interface DealingsParams extends PageParams, DateRangeParams {
  companyCode?: string
}

export const announcementKeys = {
  all: ['announcements'] as const,
  list: (params: AnnouncementsParams = {}) => [...announcementKeys.all, 'list', params] as const,
  detail: (id: string) => [...announcementKeys.all, 'detail', id] as const,
  dealings: (params: DealingsParams = {}) => [...announcementKeys.all, 'dealings', params] as const,
}

/** GET /announcements — market-wide feed, newest first. */
export const announcementsQuery = (params: AnnouncementsParams = {}) =>
  queryOptions({
    queryKey: announcementKeys.list(params),
    queryFn: ({ signal }) =>
      apiGet(
        withQuery('/announcements', {
          category: csv(params.category),
          companyCode: params.companyCode,
          from: params.from,
          to: params.to,
          offset: params.offset,
          limit: params.limit,
        }),
        MarketAnnouncementsPage,
        { signal },
      ),
  })

/** GET /announcements/:id — one announcement (404 -> ApiError for an unknown id). */
export const announcementQuery = (id: string) =>
  queryOptions({
    queryKey: announcementKeys.detail(id),
    queryFn: ({ signal }) =>
      apiGet(`/announcements/${encodeURIComponent(id)}`, AnnouncementDetail, { signal }),
  })

/** GET /disclosures/dealings — substantial-shareholder / director dealings feed. */
export const dealingsQuery = (params: DealingsParams = {}) =>
  queryOptions({
    queryKey: announcementKeys.dealings(params),
    queryFn: ({ signal }) =>
      apiGet(
        withQuery('/disclosures/dealings', {
          companyCode: params.companyCode,
          from: params.from,
          to: params.to,
          offset: params.offset,
          limit: params.limit,
        }),
        MarketAnnouncementsPage,
        { signal },
      ),
  })
