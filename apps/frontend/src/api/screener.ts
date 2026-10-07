import { queryOptions } from '@tanstack/react-query'
import {
  ScreenerFieldsResponse,
  ScreenerResponse,
  type ListingBoard,
  type ScreenerSortKey,
  type SortDirection,
} from '@tuju/contracts'
import { apiGet, withQuery } from '../lib/api'
import { csv, type PageParams } from './params'

/**
 * `GET /screener` params. Names match the backend's `RawScreenerParams`
 * (apps/backend/src/screener/params.ts). The backend clamps/drops anything
 * invalid rather than returning 400. `board` and `sector` are lists (sent
 * comma-separated; `sector` entries are sector-index UUIDs from
 * `/screener/fields`); `shariah`/`aboveSma*` are booleans; the rest are numeric
 * bands.
 */
export interface ScreenerParams extends PageParams {
  board?: readonly ListingBoard[]
  sector?: readonly string[]
  shariah?: boolean
  priceMin?: number
  priceMax?: number
  volumeMin?: number
  marketCapMin?: number
  marketCapMax?: number
  peMin?: number
  peMax?: number
  dyMin?: number
  dyMax?: number
  pNtaMin?: number
  pNtaMax?: number
  roeMin?: number
  roeMax?: number
  deMin?: number
  deMax?: number
  profitableYearsMin?: number
  yoyProfitGrowthMin?: number
  consecutiveGrowthQuartersMin?: number
  rsi14Min?: number
  rsi14Max?: number
  aboveSma50?: boolean
  aboveSma200?: boolean
  sort?: ScreenerSortKey
  dir?: SortDirection
}

export const screenerKeys = {
  all: ['screener'] as const,
  results: (params: ScreenerParams) => [...screenerKeys.all, 'results', params] as const,
  fields: () => [...screenerKeys.all, 'fields'] as const,
}

/** GET /screener — one filtered, sorted page of the analysed universe. */
export const screenerQuery = (params: ScreenerParams = {}) =>
  queryOptions({
    queryKey: screenerKeys.results(params),
    queryFn: ({ signal }) => {
      const { board, sector, ...rest } = params
      return apiGet(
        withQuery('/screener', { ...rest, board: csv(board), sector: csv(sector) }),
        ScreenerResponse,
        { signal },
      )
    },
  })

/** GET /screener/fields — filter vocabulary plus board/sector domains. */
export const screenerFieldsQuery = () =>
  queryOptions({
    queryKey: screenerKeys.fields(),
    queryFn: ({ signal }) => apiGet('/screener/fields', ScreenerFieldsResponse, { signal }),
  })
