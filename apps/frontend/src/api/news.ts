import { queryOptions } from '@tanstack/react-query'
import { NewsPage } from '@tuju/contracts'
import { apiGet, withQuery } from '../lib/api'
import type { PageParams } from './params'

/** Omit `companyCode` for the untagged market-level feed. */
export interface NewsParams extends PageParams {
  companyCode?: string
}

export const newsKeys = {
  all: ['news'] as const,
  list: (params: NewsParams = {}) => [...newsKeys.all, params] as const,
}

/** GET /news — headlines + links only. */
export const newsQuery = (params: NewsParams = {}) =>
  queryOptions({
    queryKey: newsKeys.list(params),
    queryFn: ({ signal }) =>
      apiGet(
        withQuery('/news', {
          companyCode: params.companyCode,
          offset: params.offset,
          limit: params.limit,
        }),
        NewsPage,
        { signal },
      ),
  })
