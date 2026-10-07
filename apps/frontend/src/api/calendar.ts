import { queryOptions } from '@tanstack/react-query'
import {
  CorporateActionCalendarWindow,
  ResultsCalendarWindow,
  type CorporateActionType,
} from '@tuju/contracts'
import { apiGet, withQuery } from '../lib/api'
import { csv, type DateRangeParams } from './params'

export interface CorporateActionCalendarParams extends DateRangeParams {
  type?: readonly CorporateActionType[]
  companyCode?: string
}

export interface ResultsCalendarParams extends DateRangeParams {
  companyCode?: string
}

export const calendarKeys = {
  all: ['calendar'] as const,
  corporateActions: (params: CorporateActionCalendarParams = {}) =>
    [...calendarKeys.all, 'corporate-actions', params] as const,
  results: (params: ResultsCalendarParams = {}) =>
    [...calendarKeys.all, 'results', params] as const,
}

/** GET /calendar/corporate-actions — exDate calendar (default window: -7d..+30d). */
export const corporateActionCalendarQuery = (params: CorporateActionCalendarParams = {}) =>
  queryOptions({
    queryKey: calendarKeys.corporateActions(params),
    queryFn: ({ signal }) =>
      apiGet(
        withQuery('/calendar/corporate-actions', {
          from: params.from,
          to: params.to,
          type: csv(params.type),
          companyCode: params.companyCode,
        }),
        CorporateActionCalendarWindow,
        { signal },
      ),
  })

/** GET /calendar/results — when companies filed quarterly results (backward-looking). */
export const resultsCalendarQuery = (params: ResultsCalendarParams = {}) =>
  queryOptions({
    queryKey: calendarKeys.results(params),
    queryFn: ({ signal }) =>
      apiGet(
        withQuery('/calendar/results', {
          from: params.from,
          to: params.to,
          companyCode: params.companyCode,
        }),
        ResultsCalendarWindow,
        { signal },
      ),
  })
