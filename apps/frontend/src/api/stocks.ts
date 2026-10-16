import { queryOptions } from '@tanstack/react-query'
import {
  AnnouncementsPage,
  StockCorePayload,
  CorporateActionsPage,
  StockSeriesResponse,
  StockTechnicalAnalysisResponse,
  StockFundamentalAnalysisResponse,
  StockTechnicalAnalysisArtifact,
  StockFundamentalAnalysisArtifact,
  type AnnouncementCategory,
  type CorporateActionType,
} from '@tuju/contracts'
import { apiGet, withQuery } from '../lib/api'
import { csv, type PageParams } from './params'
import {
  canReadStockArtifact,
  readCoherentArtifact,
  resultIdentity,
  stockArtifactMatches,
  type StockAnalysisKind,
  type StockAnalysisSummary,
  type ArtifactRead,
} from './result-coherence'

export interface StockAnnouncementsParams extends PageParams {
  category?: readonly AnnouncementCategory[]
}

export interface StockCorporateActionsParams extends PageParams {
  type?: readonly CorporateActionType[]
}

export const stockKeys = {
  all: ['stocks'] as const,
  core: (code: string) => [...stockKeys.all, code, 'core'] as const,
  series: (code: string) => [...stockKeys.all, code, 'series', '1d', '2y'] as const,
  analysis: (code: string, kind: StockAnalysisKind) =>
    [...stockKeys.all, code, 'analysis', kind] as const,
  artifact: (code: string, kind: StockAnalysisKind, expected: StockAnalysisSummary | null) =>
    [
      ...stockKeys.analysis(code, kind), 'artifact', resultIdentity(expected),
      expected?.code, expected?.jobName,
    ] as const,
  announcements: (code: string, params: StockAnnouncementsParams = {}) =>
    [...stockKeys.all, code, 'announcements', params] as const,
  corporateActions: (code: string, params: StockCorporateActionsParams = {}) =>
    [...stockKeys.all, code, 'corporate-actions', params] as const,
}

const stockPath = (code: string) => `/stocks/${encodeURIComponent(code)}`

export const stockSeriesQuery = (code: string) =>
  queryOptions({
    queryKey: stockKeys.series(code),
    queryFn: ({ signal }) =>
      apiGet(`${stockPath(code)}/series?interval=1d&range=2y`, StockSeriesResponse, { signal }),
  })

export const stockTechnicalAnalysisQuery = (code: string) =>
  queryOptions({
    queryKey: stockKeys.analysis(code, 'technical'),
    queryFn: ({ signal }) =>
      apiGet(`${stockPath(code)}/analysis/technical`, StockTechnicalAnalysisResponse, { signal }),
  })

export const stockFundamentalAnalysisQuery = (code: string) =>
  queryOptions({
    queryKey: stockKeys.analysis(code, 'fundamental'),
    queryFn: ({ signal }) =>
      apiGet(`${stockPath(code)}/analysis/fundamental`, StockFundamentalAnalysisResponse, { signal }),
  })

export const stockTechnicalArtifactQuery = (
  code: string,
  expected: StockTechnicalAnalysisResponse | null,
) =>
  queryOptions({
    queryKey: stockKeys.artifact(code, 'technical', expected),
    enabled: canReadStockArtifact(code, 'technical', expected),
    queryFn: ({ signal }): Promise<ArtifactRead<StockTechnicalAnalysisArtifact>> => {
      if (!canReadStockArtifact(code, 'technical', expected)) {
        return Promise.resolve({ status: 'unavailable' })
      }
      return readCoherentArtifact(
        () => apiGet(`${stockPath(code)}/analysis/technical/artifact`, StockTechnicalAnalysisArtifact, { signal }),
        artifact => stockArtifactMatches(code, 'technical', expected, artifact),
        signal,
      )
    },
  })

export const stockFundamentalArtifactQuery = (
  code: string,
  expected: StockFundamentalAnalysisResponse | null,
) =>
  queryOptions({
    queryKey: stockKeys.artifact(code, 'fundamental', expected),
    enabled: canReadStockArtifact(code, 'fundamental', expected),
    queryFn: ({ signal }): Promise<ArtifactRead<StockFundamentalAnalysisArtifact>> => {
      if (!canReadStockArtifact(code, 'fundamental', expected)) {
        return Promise.resolve({ status: 'unavailable' })
      }
      return readCoherentArtifact(
        () => apiGet(`${stockPath(code)}/analysis/fundamental/artifact`, StockFundamentalAnalysisArtifact, { signal }),
        artifact => stockArtifactMatches(code, 'fundamental', expected, artifact),
        signal,
      )
    },
  })

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

/**
 * GET /stocks/:code/corporate-actions?type&offset&limit — by exDate ascending.
 * Retained as part of the original typed stocks API surface; the UI has not
 * consumed it yet, but callers can use the builder and its typed key/schema.
 */
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
