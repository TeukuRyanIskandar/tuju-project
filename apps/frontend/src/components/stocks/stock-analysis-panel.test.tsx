import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import type { StockTechnicalAnalysisResponse, StockTechnicalAnalysisArtifact } from '@tuju/contracts'
import type { AnalysisResultsState } from '#/api/analysis-results'
import { ApiError } from '#/lib/api'
import { AnalysisPanel, TechnicalAnalysisPanel, FundamentalAnalysisPanel } from './stock-analysis-panel'
import { TechnicalAnalysis } from './technical-analysis'
import { FundamentalAnalysis } from './fundamental-analysis'
import { technical, fundamental, technicalSummary, fundamentalSummary } from './analysis-fixtures'

afterEach(() => vi.unstubAllGlobals())
const matched = () => ({ summary: structuredClone(technicalSummary), artifact: structuredClone(technical) })
function show(overrides: Partial<AnalysisResultsState<StockTechnicalAnalysisResponse, StockTechnicalAnalysisArtifact>> = {}) {
  const state: AnalysisResultsState<StockTechnicalAnalysisResponse, StockTechnicalAnalysisArtifact> = {
    identity: '1155-ta', summary: technicalSummary, summaryError: undefined, refreshingSummary: false,
    detail: { status: 'matched', pair: matched() }, previousPair: undefined, ...overrides,
  }
  return render(<AnalysisPanel title="Technical analysis" code="1155" jobName="analyze-technical" state={state} refresh={async () => {}}>{artifact => <TechnicalAnalysis artifact={artifact} />}</AnalysisPanel>)
}
it('separates computed facts, narrative, dates and fired/not-fired structured observations', () => {
  const pair = matched()
  pair.artifact.facts.sma.p20 = 0
  pair.artifact.facts.sma.p50 = null
  pair.artifact.events = [
    { id: 'macd_cross', label: 'MACD check', fired: true, values: { zero: 0, missing: null, flag: false }, at: '2026-10-08' },
    { id: 'rsi_band', label: 'RSI check', fired: false, values: {}, at: '2026-10-07' },
  ]
  show({ detail: { status: 'matched', pair } })
  expect(screen.getByText('Computed facts')).toBeInTheDocument()
  expect(screen.getByText('AI explanation')).toBeInTheDocument()
  expect(screen.getByText(pair.artifact.narrative.text)).toBeInTheDocument()
  expect(screen.getByText('Fired')).toBeInTheDocument()
  expect(screen.getByText('Not fired')).toBeInTheDocument()
  expect(screen.getByText('false')).toBeInTheDocument()
  expect(screen.getByText(/Timeframe: 1D/)).toHaveTextContent('2026-10-08T18:00:00.000Z')
  for (const label of ['SMA 20', 'SMA 50', 'SMA 200', 'RSI-14', 'MACD line', 'MACD signal', 'MACD histogram', '52-week low', '52-week high']) expect(screen.getByText(label)).toBeInTheDocument()
  expect(screen.getByText('SMA 20').parentElement).toHaveTextContent('0')
  expect(screen.getByText('SMA 50').parentElement).toHaveTextContent('Unavailable')
})
it('renders every FA metric in canonical order, dates/units and missing/duplicate values honestly', () => {
  const a = structuredClone(fundamental)
  a.metrics[0].value = 0
  render(<FundamentalAnalysis artifact={a} />)
  expect(screen.getByText('0 ratio')).toBeInTheDocument()
  expect(screen.getByText('5.67%')).toBeInTheDocument()
  expect(screen.getByText('11.34%')).toBeInTheDocument()
  expect(screen.getByText('myr 4,200,000,000')).toBeInTheDocument()
  expect(screen.getByText('Unavailable · unit: ratio')).toBeInTheDocument()
  expect(screen.getAllByText(/Metric date:/)).toHaveLength(9)
  expect(screen.getByText(/revenue_growth_qoq · Unit:/)).toHaveTextContent('2026-06-30')
})
it.each(['pending', 'running', 'ready', 'facts_only', 'stale', 'failed'] as const)('presents %s explicitly without a rich result', status => {
  show({ summary: { ...technicalSummary, status, artifact: null }, detail: { status: 'unavailable' } })
  expect(screen.getByLabelText('Latest analysis summary')).toHaveTextContent(status === 'facts_only' ? 'Facts only' : status)
  expect(screen.getByText('No matching analysis detail available.')).toBeInTheDocument()
  expect(screen.queryByText('Computed facts')).not.toBeInTheDocument()
})
it.each(['stale', 'failed', 'ready', 'facts_only'] as const)('suppresses producer placeholder narrative under %s', status => {
  const pair = matched()
  pair.summary.status = status
  pair.artifact.narrative.text = 'Narrative withheld: failed the grounding check.'
  pair.summary.headline = 'facts-only: Grounding check failed.'
  show({ summary: pair.summary, detail: { status: 'matched', pair } })
  expect(screen.getByText('AI explanation unavailable. Computed facts remain available.')).toBeInTheDocument()
  expect(screen.queryByText(/Narrative withheld|Grounding check failed/)).not.toBeInTheDocument()
  expect(screen.getByText('Computed facts')).toBeInTheDocument()
})
it.each(['idle', 'loading', 'unavailable', 'mismatch', 'error'] as const)('labels retained matched output separately during detail %s', status => {
  const previousPair = matched()
  show({ summary: { ...technicalSummary, asOf: '2026-10-09T00:00:00Z', headline: 'New summary' }, previousPair, detail: status === 'error' ? { status, error: Error('private-bucket stack cost') } : { status } })
  expect(screen.getByLabelText('Latest analysis summary')).toHaveTextContent('2026-10-09')
  const retained = screen.getByRole('region', { name: 'Retained analysis result' })
  expect(retained).toHaveTextContent('Retained previous matched result — not current')
  expect(retained).toHaveTextContent('2026-10-08T18:00:00.000Z')
  expect(retained).not.toHaveTextContent('New summary')
  expect(document.body).not.toHaveTextContent('private-bucket stack cost')
})
it('shows safe 404 and refresh errors without private diagnostics, with retained output', () => {
  show({ summaryError: new ApiError(404, { stack: 'secret' }, '/private'), previousPair: matched(), detail: { status: 'idle' } })
  expect(screen.getByRole('alert')).toHaveTextContent('Analysis is not available')
  expect(screen.getByText('Retained summary — not a successful current read.')).toBeInTheDocument()
  expect(document.body).not.toHaveTextContent('secret')
  expect(document.body).not.toHaveTextContent('private-key')
})
it('does not display a mismatched thin summary', () => {
  show({ summary: { ...technicalSummary, code: '1023', headline: 'Other stock' }, detail: { status: 'unavailable' } })
  expect(screen.getByRole('alert')).toHaveTextContent('identity does not match')
  expect(screen.queryByText('Other stock')).not.toBeInTheDocument()
})
it('shows initial loading without inventing output', () => {
  show({ summary: undefined, refreshingSummary: true, detail: { status: 'idle' } })
  expect(screen.getByRole('status')).toHaveTextContent('Loading analysis summary')
  expect(screen.getByRole('button')).toBeDisabled()
  expect(screen.queryByText('AI explanation')).not.toBeInTheDocument()
})
it('shows a summary failure without retained output safely', () => {
  show({ summary: undefined, summaryError: Error('stack secret costUsd'), detail: { status: 'idle' } })
  expect(screen.getByRole('alert')).toHaveTextContent('Analysis summary unavailable')
  expect(screen.getByRole('button')).toBeEnabled()
  expect(document.body).not.toHaveTextContent('stack secret costUsd')
  expect(screen.queryByText('Computed facts')).not.toBeInTheDocument()
})
it('handles empty event lists, blank narration and duplicated/missing metrics without invented explanations', () => {
  const a = structuredClone(fundamental)
  a.metrics[0] = a.metrics[1]
  render(<FundamentalAnalysis artifact={a} />)
  expect(screen.getAllByText('Unavailable — missing or duplicate metric')).toHaveLength(2)
  const pair = matched()
  pair.artifact.events = []
  pair.artifact.narrative.text = ' '
  show({ detail: { status: 'matched', pair } })
  expect(screen.getByText('No structured events available.')).toBeInTheDocument()
  expect(screen.getByText('AI explanation unavailable. Computed facts remain available.')).toBeInTheDocument()
})
function mountPanels() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><TechnicalAnalysisPanel code="1155" /><FundamentalAnalysisPanel code="1155" /></QueryClientProvider>)
}
it.each(['symbol', 'jobName', 'asOf'] as const)('rejects persistent %s mismatch after exactly two artifact GETs and keeps FA independent', async key => {
  let artifactReads = 0
  const fetch = vi.fn(async (input: string) => {
    if (input.includes('/technical/artifact')) { artifactReads++; return Response.json({ ...technical, [key]: key === 'symbol' ? '1023' : key === 'jobName' ? 'analyze-fundamental' : '2026-10-09T00:00:00Z' }) }
    if (input.includes('/fundamental/artifact')) return Response.json(fundamental)
    return Response.json(input.endsWith('/technical') ? technicalSummary : fundamentalSummary)
  })
  vi.stubGlobal('fetch', fetch)
  mountPanels()
  const ta = within(screen.getByRole('region', { name: 'Technical analysis' }))
  const fa = within(screen.getByRole('region', { name: 'Fundamental analysis' }))
  // A wrong job kind fails strict schema validation rather than reaching coherence.
  expect(await ta.findByRole('alert')).toHaveTextContent(key === 'jobName' ? 'detail unavailable' : 'does not match')
  expect(artifactReads).toBe(key === 'jobName' ? 1 : 2)
  expect(await fa.findByText('5.67%')).toBeInTheDocument()
  expect(ta.queryByText('Computed facts')).not.toBeInTheDocument()
  await userEvent.click(fa.getByRole('button', { name: 'Refresh fundamental analysis' }))
  await waitFor(() => expect(fetch.mock.calls.filter(([url]) => url.endsWith('/fundamental'))).toHaveLength(2))
  expect(artifactReads).toBe(key === 'jobName' ? 1 : 2)
})
it.each([null, {}, { ...technical, facts: null }])('keeps a malformed/empty artifact failure local', async body => {
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    if (input.includes('/technical/artifact')) return Response.json(body)
    if (input.includes('/fundamental/artifact')) return Response.json(fundamental)
    return Response.json(input.endsWith('/technical') ? technicalSummary : fundamentalSummary)
  }))
  mountPanels()
  expect(await within(screen.getByRole('region', { name: 'Technical analysis' })).findByRole('alert')).toHaveTextContent('Analysis detail unavailable')
  expect(await within(screen.getByRole('region', { name: 'Fundamental analysis' })).findByText('5.67%')).toBeInTheDocument()
})
it('never carries rich output into a different stock while its reads are pending', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    if (input.includes('/1023/')) return new Promise<Response>(() => {})
    return Response.json(input.endsWith('/artifact') ? technical : technicalSummary)
  }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = (code: string) => <QueryClientProvider client={client}><TechnicalAnalysisPanel code={code} /></QueryClientProvider>
  const { rerender } = render(view('1155'))
  expect(await screen.findByText(technical.narrative.text)).toBeInTheDocument()
  rerender(view('1023'))
  expect(screen.queryByText(technical.narrative.text)).not.toBeInTheDocument()
  expect(screen.queryByText('Computed facts')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Loading analysis summary')
})
