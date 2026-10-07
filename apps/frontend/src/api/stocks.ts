import { queryOptions } from '@tanstack/react-query'
import {
  AnnouncementsPage,
  StockCorePayload,
  CorporateActionsPage,
  type AnnouncementCategory,
  type CorporateActionType,
} from '@tuju/contracts'
import { apiGet, withQuery } from '../lib/api'
import { csv, type PageParams } from './params'

export interface StockAnnouncementsParams extends PageParams {
  category?: readonly AnnouncementCategory[]
}

export interface StockCorporateActionsParams extends PageParams {
  type?: readonly CorporateActionType[]
}

export const stockKeys = {
  all: ['stocks'] as const,
  core: (code: string) => [...stockKeys.all, code, 'core'] as const,
  announcements: (code: string, params: StockAnnouncementsParams = {}) =>
    [...stockKeys.all, code, 'announcements', params] as const,
  corporateActions: (code: string, params: StockCorporateActionsParams = {}) =>
    [...stockKeys.all, code, 'corporate-actions', params] as const,
}

const stockPath = (code: string) => `/stocks/${encodeURIComponent(code)}`

/** GET /stocks/:code — the bounded core snapshot. */
export const stockCoreQuery = (code: string) =>
  queryOptions({
    queryKey: stockKeys.core(code),
    queryFn: ({ signal }) => apiGet(stockPath(code), StockCorePayload, { signal }),
  })

/** GET /stocks/:code/announcements?category&offset&limit — newest first. */
export const stockAnnouncementsQuery = (code: string, params: StockAnnouncementsParams = {}) =>
  queryOptions({
    queryKey: stockKeys.announcements(code, params),
    queryFn: ({ signal }) =>
      apiGet(
        withQuery(`${stockPath(code)}/announcements`, {
          category: csv(params.category),
          offset: params.offset,
          limit: params.limit,
        }),
        AnnouncementsPage,
        { signal },
      ),
  })

/** GET /stocks/:code/corporate-actions?type&offset&limit — by exDate ascending. */
export const stockCorporateActionsQuery = (
  code: string,
  params: StockCorporateActionsParams = {},
) =>
  queryOptions({
    queryKey: stockKeys.corporateActions(code, params),
    queryFn: ({ signal }) =>
      apiGet(
        withQuery(`${stockPath(code)}/corporate-actions`, {
          type: csv(params.type),
          offset: params.offset,
          limit: params.limit,
        }),
        CorporateActionsPage,
        { signal },
      ),
  })
