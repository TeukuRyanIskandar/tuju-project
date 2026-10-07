import { queryOptions } from '@tanstack/react-query'
import {
  IndicesResponse,
  IndexSeriesResponse,
  MoversResponse,
  SectorsResponse,
  type IndexSeriesRange,
  type MoversBoardType,
} from '@tuju/contracts'
import { apiGet, withQuery } from '../lib/api'

export interface MoversParams {
  type?: MoversBoardType
  limit?: number
}

export const marketKeys = {
  all: ['market'] as const,
  movers: (params: MoversParams = {}) => [...marketKeys.all, 'movers', params] as const,
  indices: () => [...marketKeys.all, 'indices'] as const,
  indexSeries: (id: string, range?: IndexSeriesRange) =>
    [...marketKeys.all, 'indices', id, 'series', range ?? null] as const,
  sectors: () => [...marketKeys.all, 'sectors'] as const,
}

/** GET /market/movers?type&limit — gainers / losers / actives board. */
export const moversQuery = (params: MoversParams = {}) =>
  queryOptions({
    queryKey: marketKeys.movers(params),
    queryFn: ({ signal }) =>
      apiGet(
        withQuery('/market/movers', { type: params.type, limit: params.limit }),
        MoversResponse,
        { signal },
      ),
  })

/** GET /market/indices — headline + sector index panel. */
export const indicesQuery = () =>
  queryOptions({
    queryKey: marketKeys.indices(),
    queryFn: ({ signal }) => apiGet('/market/indices', IndicesResponse, { signal }),
  })

/** GET /market/indices/:id/series?range — stored level history for one index. */
export const indexSeriesQuery = (id: string, range?: IndexSeriesRange) =>
  queryOptions({
    queryKey: marketKeys.indexSeries(id, range),
    queryFn: ({ signal }) =>
      apiGet(
        withQuery(`/market/indices/${encodeURIComponent(id)}/series`, { range }),
        IndexSeriesResponse,
        { signal },
      ),
  })

/** GET /market/sectors — per-sector %change board. */
export const sectorsQuery = () =>
  queryOptions({
    queryKey: marketKeys.sectors(),
    queryFn: ({ signal }) => apiGet('/market/sectors', SectorsResponse, { signal }),
  })
