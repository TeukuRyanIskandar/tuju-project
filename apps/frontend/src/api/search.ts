import { queryOptions } from '@tanstack/react-query'
import { SearchResponse } from '@tuju/contracts'
import { apiGet, withQuery } from '../lib/api'

export interface SearchParams {
  q: string
  limit?: number
}

export const searchKeys = {
  all: ['search'] as const,
  results: (params: SearchParams) => [...searchKeys.all, params] as const,
}

/** GET /search?q=&limit= — trigram-ranked identity rows. */
export const searchQuery = (params: SearchParams) =>
  queryOptions({
    queryKey: searchKeys.results(params),
    queryFn: ({ signal }) =>
      apiGet(withQuery('/search', { q: params.q, limit: params.limit }), SearchResponse, {
        signal,
      }),
  })
