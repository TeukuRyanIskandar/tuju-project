import { queryOptions } from '@tanstack/react-query'
import { MarketBriefResponse } from '@tuju/contracts'
import { apiGet } from '../lib/api'

export const briefKeys = {
  all: ['market-brief'] as const,
  latest: () => [...briefKeys.all, 'latest'] as const,
}

/** GET /market-brief/latest — headline plus the artifact pointer (404 until one exists). */
export const latestBriefQuery = () =>
  queryOptions({
    queryKey: briefKeys.latest(),
    queryFn: ({ signal }) => apiGet('/market-brief/latest', MarketBriefResponse, { signal }),
  })
