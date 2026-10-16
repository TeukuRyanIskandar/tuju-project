import { useEffect, useState, type ReactNode } from 'react'
import { StockTechnicalAnalysisArtifact, StockFundamentalAnalysisArtifact, type StockTechnicalAnalysisResponse, type StockFundamentalAnalysisResponse } from '@tuju/contracts'
import type { AnalysisResultsState } from '#/api/analysis-results'
import { Panel } from '#/components/panel'
import { ApiError } from '#/lib/api'
import { analysisDate, isFactsOnly } from './analysis-presentation'
import { TechnicalAnalysis } from './technical-analysis'
import { FundamentalAnalysis } from './fundamental-analysis'
import { useStockTechnical, useStockFundamental } from './use-stock-analysis'

type Summary = StockTechnicalAnalysisResponse | StockFundamentalAnalysisResponse
type Artifact = StockTechnicalAnalysisArtifact | StockFundamentalAnalysisArtifact
export function AnalysisPanel<S extends Summary, A extends Artifact>({ title, code, jobName, state, refresh, children }: {
  title: string; code: string; jobName: Summary['jobName']; state: AnalysisResultsState<S, A>; refresh: () => Promise<void>; children: (artifact: A) => ReactNode
}) {
  const invalidSummary = state.summary && (state.summary.code !== code || state.summary.jobName !== jobName)
  const summary = invalidSummary ? undefined : state.summary
  const candidate = state.detail.status === 'matched' ? state.detail.pair : state.previousPair
  // apiGet deliberately skips runtime validation in production. Do not let an
  // identity-matched but incomplete body break other independent stock panels.
  const validArtifact = (artifact: A) => jobName === 'analyze-technical'
    ? StockTechnicalAnalysisArtifact.safeParse(artifact).success
    : StockFundamentalAnalysisArtifact.safeParse(artifact).success
  const validShape = !candidate || validArtifact(candidate.artifact)
  const [lastRenderable, setLastRenderable] = useState<{ identity: string; pair: NonNullable<typeof candidate> }>()
  useEffect(() => {
    if (candidate && validShape) setLastRenderable({ identity: state.identity, pair: candidate })
  }, [candidate, validShape, state.identity])
  // A malformed production body can pass metadata coherence. Preserve the last
  // renderable pair even across repeated malformed reads, but never identities.
  const fallback = state.previousPair && validArtifact(state.previousPair.artifact) ? state.previousPair
    : lastRenderable?.identity === state.identity ? lastRenderable.pair : undefined
  const pair = validShape && candidate ? candidate : fallback
  const retained = !!pair && (state.detail.status !== 'matched' || !validShape)
  // A failed detail read and a candidate that fails the browser schema are two
  // routes to the same outcome, and a retained malformed pair makes them
  // co-occur. One flag keeps the message a single announcement.
  const detailUnavailable = state.detail.status === 'error' || !validShape
  const busy = state.refreshingSummary || state.detail.status === 'loading'
  const factsOnly = pair && isFactsOnly(pair.summary, pair.artifact.narrative.text)
  return <Panel title={title} className="min-w-0">
    <div className="space-y-2 break-words text-xs [overflow-wrap:anywhere]">
      <button type="button" className="h-7 rounded-md border border-control-border bg-surface-2 px-2 hover:bg-surface-3 disabled:opacity-50" disabled={busy} onClick={() => void refresh()}>Refresh {title.toLowerCase()}</button>
      <p className="text-fg-3">Read-only refresh · no jobs submitted</p>
      {busy && <p role="status">{state.refreshingSummary ? 'Loading analysis summary…' : 'Loading analysis detail…'}</p>}
      {state.summaryError !== undefined && <p role="alert">{state.summaryError instanceof ApiError && state.summaryError.status === 404 ? 'Analysis is not available for this stock.' : 'Analysis summary unavailable. Retry with refresh.'}</p>}
      {invalidSummary && <p role="alert">Analysis summary identity does not match this panel.</p>}
      {!summary && !state.refreshingSummary && state.summaryError === undefined && !invalidSummary && <p>No analysis summary available.</p>}
      {summary && <div aria-label="Latest analysis summary"><p>Status: {summary.status === 'facts_only' ? 'Facts only' : summary.status}</p><p>Summary as of {analysisDate(summary.asOf)}</p>
        {(state.refreshingSummary || state.summaryError !== undefined) && <p>Retained summary — not a successful current read.</p>}
        {summary.headline && !isFactsOnly(summary) && summary.status !== 'failed' && <p>{summary.headline}</p>}
        {isFactsOnly(summary) && <p>Facts only · AI explanation unavailable.</p>}
        {summary.status === 'failed' && <p role="alert">Analysis generation failed. Refresh only reads existing results.</p>}
        {summary.status === 'stale' && <p>Stale result — not current.</p>}
        {(summary.status === 'pending' || summary.status === 'running') && <p>Analysis {summary.status}. Refresh to check again; no automatic polling.</p>}
      </div>}
      {detailUnavailable && <p role="alert">Analysis detail unavailable. Retry with refresh.</p>}
      {state.detail.status === 'mismatch' && <p role="alert">Analysis detail does not match the summary after one reread. No current verified pair.</p>}
      {state.detail.status === 'unavailable' && <p>No matching analysis detail available.</p>}
      {pair && <section aria-label={retained ? 'Retained analysis result' : 'Matched analysis result'} className="border-t border-border pt-2">
        <p className="font-semibold">{retained ? 'Retained previous matched result — not current' : 'Matched summary and detail'}{pair.summary.status === 'stale' ? ' · Stale' : ''}{pair.summary.status === 'failed' ? ' · Failed run with retained output' : ''}</p>
        <p>Result as of {analysisDate(pair.artifact.asOf)} · Generated {analysisDate(pair.artifact.provenance.generatedAt)}</p>
        <p className="text-fg-3">Source: {pair.artifact.provenance.source} · {pair.artifact.provenance.adapter} · Precomputed snapshot, not live</p>
        {children(pair.artifact)}
        <h3 className="mt-3 font-semibold">AI explanation</h3>
        {factsOnly || !pair.artifact.narrative.text.trim() ? <p>AI explanation unavailable. Computed facts remain available.</p> : <><p className="text-fg-3">AI-generated · Language: {pair.artifact.narrative.language}</p><p lang={pair.artifact.narrative.language} className="whitespace-pre-wrap">{pair.artifact.narrative.text}</p></>}
      </section>}
    </div>
  </Panel>
}
export function TechnicalAnalysisPanel({ code }: { code: string }) {
  const { state, refresh } = useStockTechnical(code)
  return <AnalysisPanel title="Technical analysis" code={code} jobName="analyze-technical" state={state} refresh={refresh}>{artifact => <TechnicalAnalysis artifact={artifact} />}</AnalysisPanel>
}
export function FundamentalAnalysisPanel({ code }: { code: string }) {
  const { state, refresh } = useStockFundamental(code)
  return <AnalysisPanel title="Fundamental analysis" code={code} jobName="analyze-fundamental" state={state} refresh={refresh}>{artifact => <FundamentalAnalysis artifact={artifact} />}</AnalysisPanel>
}
