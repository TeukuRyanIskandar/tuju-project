import { useState, type ReactNode } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { stockCoreQuery, stockSeriesQuery } from '#/api/stocks'
import { newsQuery } from '#/api/news'
import { Panel } from '#/components/panel'
import { ProvenanceSource } from '#/components/provenance'
import { EmptyState, ErrorState, LoadingState } from '#/components/states'
import { formatDate, formatDateTime, formatRm } from '#/lib/format'
import { historyWindow, parseHistory, type HistoryRange } from './stock-history'
import { StockHistoryChart } from './stock-history-chart'
import { TechnicalAnalysisPanel, FundamentalAnalysisPanel } from './stock-analysis-panel'

const control = 'h-7 rounded-md border border-control-border bg-surface-2 px-2 text-xs hover:bg-surface-3 aria-pressed:border-primary aria-pressed:bg-accent-soft aria-pressed:text-primary'

function ReadState<T>({ query, children, showMeta = true }: { query: UseQueryResult<T>; children: ReactNode; showMeta?: boolean }) {
  if (query.data === undefined) return query.isError
    ? <ErrorState title="Panel unavailable" onRetry={() => void query.refetch()} /> : <LoadingState />
  return <>
    {query.isError && <ErrorState title="Refresh failed — showing retained snapshot" onRetry={() => void query.refetch()} />}
    {query.isFetching && <p role="status" className="text-xs text-fg-3">Refreshing…</p>}
    {children}
    {showMeta && <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-3">
      <span>Retrieved {formatDateTime(new Date(query.dataUpdatedAt))} · Quote time unavailable</span>
      <button type="button" className={control} disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh</button>
    </div>}
  </>
}

export function StockDetail({ code }: { code: string }) {
  const [range, setRange] = useState<HistoryRange>('1Y')
  const core = useQuery({ ...stockCoreQuery(code), select: data => {
    if (data?.identity?.stockCode !== code) throw new Error('Stock identity mismatch')
    return data
  } })
  const series = useQuery({ ...stockSeriesQuery(code), select: data => {
    if (data?.code !== code || data.interval !== '1d' || data.range !== '2y') throw new Error('Stock series identity mismatch')
    return data
  } })
  const news = useQuery(newsQuery({ companyCode: code, limit: 5 }))
  const points = parseHistory(series.data?.points)
  const latest = points.at(-1)
  const visible = historyWindow(points, range)
  return <div className="min-w-0 space-y-3 p-3">
    <Link to="/" className="text-xs text-fg-2 hover:underline">← Back to market</Link>
    <Panel title="Stock identity" className="min-w-0">
      <h1 className="mb-2 break-words text-xl font-semibold">{core.data ? `${code} · ${core.data.identity.shortName}` : `Stock ${code}`}</h1>
      {series.data === undefined ? series.isError
        ? <ErrorState title="Series EOD close unavailable" onRetry={() => void series.refetch()} />
        : <LoadingState />
        : <>
          {series.isError && <ErrorState title="Series refresh failed — showing retained EOD snapshot" onRetry={() => void series.refetch()} />}
          {series.isFetching && <p role="status" className="text-xs text-fg-3">Refreshing EOD data…</p>}
          <p className="num mb-2 break-words text-base">Series EOD close: {latest ? formatRm(latest.close, { decimals: 3 }) : 'No stored EOD data'} · Trading date: {latest ? formatDate(latest.date) : '—'}</p>
        </>}
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
      <TechnicalAnalysisPanel code={code} />
      <FundamentalAnalysisPanel code={code} />
    </div>
    <Panel title="Stock news" className="min-w-0">
      <div className="mb-2 border border-dashed border-synthetic bg-synthetic-bg p-2 text-xs text-fg">
        <strong className="text-synthetic">DEMO NEWS</strong> · Illustrative headlines only; Demo Wire and example.test are not real news sources.
      </div>
      {news.data === undefined ? news.isError
        ? <ErrorState title="News unavailable" onRetry={() => void news.refetch()} />
        : <LoadingState label="Loading stock news…" />
        : <>
          {news.isError && <ErrorState title="News refresh failed — showing retained headlines" onRetry={() => void news.refetch()} />}
          {news.isFetching && <p role="status" className="text-xs text-fg-3">Refreshing news…</p>}
          {news.data.items.length === 0 ? <EmptyState title="No stock news available" /> : <ul className="divide-y divide-border">
            {news.data.items.slice(0, 5).map((item, index) => {
              let safeUrl: string | undefined
              try {
                const parsed = new URL(item.url)
                if (parsed.protocol === 'http:' || parsed.protocol === 'https:') safeUrl = parsed.href
              } catch { /* unsafe or malformed source URLs render as plain text */ }
              return <li key={`${item.url}-${index}`} className="min-w-0 py-2 first:pt-0">
                {safeUrl ? <a href={safeUrl} target="_blank" rel="noopener noreferrer" className="break-words font-medium hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{item.headline}<span className="sr-only"> (opens in a new tab)</span></a> : <span className="break-words font-medium">{item.headline}</span>}
                <p className="m-0 mt-1 text-xs text-fg-3">{item.source} · {formatDateTime(new Date(item.publishedAt))}</p>
              </li>
            })}
          </ul>}
        </>}
      <div className="mt-3 border-t border-border pt-2 text-xs text-fg-3">
        <span>News is separate from AI analysis.</span>{news.data && <span> · Retrieved {formatDateTime(new Date(news.dataUpdatedAt))}</span>}
        <button type="button" className={`${control} ml-2`} disabled={news.isFetching} onClick={() => void news.refetch()}>Refresh news</button>
      </div>
    </Panel>
  </div>
}
