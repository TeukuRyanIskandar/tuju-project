import type { QueryClient } from '@tanstack/react-query'
import type { ArtifactRead } from './result-coherence'
import { prospectusArtifactQuery, prospectusAtAGlanceQuery } from './ipo'
import {
  stockFundamentalAnalysisQuery, stockFundamentalArtifactQuery,
  stockTechnicalAnalysisQuery, stockTechnicalArtifactQuery,
} from './stocks'

export interface MatchedPair<S, A> { summary: S; artifact: A }
export type DetailState<S, A> =
  | { status: 'idle' | 'loading' | 'unavailable' | 'mismatch' }
  | { status: 'error'; error: unknown }
  | { status: 'matched'; pair: MatchedPair<S, A> }

export interface AnalysisResultsState<S, A> {
  /** Resource identity (stock + kind or prospectus), fixed for this lifecycle. */
  identity: string
  summary: S | undefined
  summaryError: unknown
  refreshingSummary: boolean
  detail: DetailState<S, A>
  /** Never combine this artifact with the current thin summary. */
  previousPair: MatchedPair<S, A> | undefined
}

/**
 * Framework-independent lifecycle for later route/hooks integration. Thin reads
 * never depend on rich availability. Create a NEW lifecycle on identity change;
 * no placeholder data/previous pair crosses stock, kind or prospectus boundaries.
 * No polling, subscriptions, component fetching or browser mutations.
 */
export function createAnalysisResults<S, A>(source: {
  identity: string
  readSummary: () => Promise<S>
  readArtifact: (summary: S) => Promise<ArtifactRead<A>>
}) {
  let generation = 0
  let detailRequest = 0
  let state: AnalysisResultsState<S, A> = {
    identity: source.identity, summary: undefined, summaryError: undefined,
    refreshingSummary: false, detail: { status: 'idle' }, previousPair: undefined,
  }
  const retainPair = () => state.detail.status === 'matched' ? state.detail.pair : state.previousPair

  async function refreshSummary() {
    const request = ++generation
    ++detailRequest // obsolete in-flight rich completions cannot attach to a new summary
    state = { ...state, refreshingSummary: true, summaryError: undefined,
      previousPair: retainPair(), detail: { status: 'idle' } }
    try {
      const summary = await source.readSummary()
      if (request !== generation) return undefined
      state = { ...state, summary, refreshingSummary: false }
      return summary
    } catch (error) {
      if (request === generation) state = { ...state, summaryError: error, refreshingSummary: false }
      return undefined
    }
  }

  async function refreshDetail() {
    const summary = state.summary
    // A failed/in-flight thin refresh cannot authorize a read against old metadata.
    if (summary === undefined || state.refreshingSummary || state.summaryError !== undefined) return state
    const request = ++detailRequest
    const summaryGeneration = generation
    state = { ...state, previousPair: retainPair(), detail: { status: 'loading' } }
    try {
      const result = await source.readArtifact(summary)
      if (request !== detailRequest || summaryGeneration !== generation) return state
      state = { ...state, detail: result.status === 'matched'
        ? { status: 'matched', pair: { summary, artifact: result.artifact } }
        : { status: result.status } }
    } catch (error) {
      if (request === detailRequest && summaryGeneration === generation) {
        state = { ...state, detail: { status: 'error', error } }
      }
    }
    return state
  }

  return {
    getState: () => state,
    refreshSummary,
    refreshDetail,
    /** Force a thin HTTP refresh first, then the artifact for that exact envelope. */
    async refresh() {
      const summary = await refreshSummary()
      if (summary !== undefined && state.summary === summary) await refreshDetail()
      return state
    },
  }
}

export const stockTechnicalResults = (client: QueryClient, code: string) => createAnalysisResults({
  identity: JSON.stringify(['stocks', code, 'technical']),
  readSummary: () => client.fetchQuery({ ...stockTechnicalAnalysisQuery(code), staleTime: 0 }),
  readArtifact: summary => client.fetchQuery({ ...stockTechnicalArtifactQuery(code, summary), staleTime: 0 }),
})

export const stockFundamentalResults = (client: QueryClient, code: string) => createAnalysisResults({
  identity: JSON.stringify(['stocks', code, 'fundamental']),
  readSummary: () => client.fetchQuery({ ...stockFundamentalAnalysisQuery(code), staleTime: 0 }),
  readArtifact: summary => client.fetchQuery({ ...stockFundamentalArtifactQuery(code, summary), staleTime: 0 }),
})

export const prospectusResults = (client: QueryClient, id: string) => createAnalysisResults({
  identity: JSON.stringify(['ipo', id]),
  readSummary: () => client.fetchQuery({ ...prospectusAtAGlanceQuery(id), staleTime: 0 }),
  readArtifact: summary => client.fetchQuery({ ...prospectusArtifactQuery(id, summary), staleTime: 0 }),
})
