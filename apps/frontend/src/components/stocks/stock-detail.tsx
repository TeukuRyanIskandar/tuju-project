import { useState, type ReactNode } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { stockCoreQuery, stockSeriesQuery } from '#/api/stocks'
import { Panel } from '#/components/panel'
import { ProvenanceSource } from '#/components/provenance'
import { EmptyState, ErrorState, LoadingState } from '#/components/states'
import { formatDate, formatDateTime, formatRm } from '#/lib/format'
import { historyWindow, parseHistory, type HistoryRange } from './stock-history'
import { StockHistoryChart } from './stock-history-chart'
import { TechnicalAnalysisPanel, FundamentalAnalysisPanel } from './stock-analysis-panel'

const control = 'h-7 rounded-md border border-control-border bg-surface-2 px-2 text-xs hover:bg-surface-3 aria-pressed:border-primary aria-pressed:bg-accent-soft aria-pressed:text-primary'

function ReadState<T>({ query, children }: { query: UseQueryResult<T>; children: ReactNode }) {
  if (query.data === undefined) return query.isError
    ? <ErrorState title="Panel unavailable" onRetry={() => void query.refetch()} /> : <LoadingState />
  return <>
    {query.isError && <ErrorState title="Refresh failed — showing retained snapshot" onRetry={() => void query.refetch()} />}
    {query.isFetching && <p role="status" className="text-xs text-fg-3">Refreshing…</p>}
    {children}
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-3">
      <span>Retrieved {formatDateTime(new Date(query.dataUpdatedAt))} · not a quote timestamp</span>
      <button type="button" className={control} disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh</button>
    </div>
  </>
}

export function StockDetail({ code }: { code: string }) {
  const [range, setRange] = useState<HistoryRange>('1Y')
  // No suspense/loader coupling, and explicitly no cross-resource placeholder data.
  const core = useQuery({ ...stockCoreQuery(code), placeholderData: undefined, select: data => {
    if (data?.identity?.stockCode !== code) throw new Error('Stock identity mismatch')
    return data
  } })
  const series = useQuery({ ...stockSeriesQuery(code), placeholderData: undefined, select: data => {
    if (data?.code !== code || data.interval !== '1d' || data.range !== '2y') throw new Error('Stock series identity mismatch')
    return data
  } })
  const points = parseHistory(series.data?.points)
  const latest = points.at(-1)
  const visible = historyWindow(points, range)
  return <div className="min-w-0 space-y-3 p-3">
    <Link to="/" className="text-xs text-fg-2 hover:underline">← Back to market</Link>
    <Panel title="Stock identity" className="min-w-0">
      <h1 className="mb-2 break-words text-xl font-semibold">{core.data ? `${code} · ${core.data.identity.shortName}` : `Stock ${code}`}</h1>
      <p className="num mb-2 break-words text-base">Series EOD close: {formatRm(latest?.close, { decimals: 3 })} · Trading date: {latest ? formatDate(latest.date) : '—'}</p>
      <ReadState query={core}>
        {core.data && <>
          <p className="break-words">{core.data.identity.fullName}</p>
          <p className="break-words text-xs text-fg-2">Issuer: {core.data.identity.companyName}</p>
          <p className="my-2 break-words text-xs text-fg-2">{core.data.identity.board} · {core.data.identity.sector}</p>
          <ProvenanceSource value={core.data.identity.provenance} />
          <p className="mt-1 text-xs text-fg-3">Identity snapshot · source effective time unavailable</p>
        </>}
      </ReadState>
    </Panel>
    <Panel title="Daily EOD history" className="min-w-0">
      <div role="group" aria-label="Price history range" className="mb-3 flex flex-wrap gap-1">
        {(['1M', '3M', '1Y', '2Y'] as const).map(value => <button key={value} type="button" className={control} aria-pressed={range === value} onClick={() => setRange(value)}>{value}</button>)}
      </div>
      <ReadState query={series}>
        {series.data && <>
          <div className="flex flex-wrap items-center gap-2"><ProvenanceSource value={series.data.provenance} /><span className="text-xs text-fg-3">Private demo · non-redistributable · daily snapshot, not live</span></div>
          <p className="num my-2 break-words">Latest stored EOD: {latest ? formatDate(latest.date) : '—'} · Close {formatRm(latest?.close, { decimals: 3 })}</p>
          <p className="text-xs text-fg-3">Calendar windows end at the latest stored trading day. Missing or duplicate values are gaps; no calendar days are invented.</p>
          {points.length ? <StockHistoryChart key={range} points={visible} /> : <EmptyState title="No daily history available" />}
        </>}
      </ReadState>
    </Panel>
    <div className="grid min-w-0 gap-3 lg:grid-cols-2">
      <TechnicalAnalysisPanel key={`ta-${code}`} code={code} />
      <FundamentalAnalysisPanel key={`fa-${code}`} code={code} />
    </div>
    <Panel title="Stock news" className="min-w-0"><p className="text-xs text-fg-3">Reserved for a later ticket · not loaded on this screen yet.</p></Panel>
  </div>
}
