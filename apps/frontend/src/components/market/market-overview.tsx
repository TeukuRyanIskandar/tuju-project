import { useState, type ReactNode } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { IndexSeriesPoint, IndexSeriesRange, MoversBoardType } from '@tuju/contracts'
import { indicesQuery, indexSeriesQuery, moversQuery, sectorsQuery } from '#/api/market'
import { stockCoreQuery, stockTechnicalAnalysisQuery, stockFundamentalAnalysisQuery } from '#/api/stocks'
import { prospectusAtAGlanceQuery } from '#/api/ipo'
import { ChangeChip } from '#/components/change-chip'
import { Panel } from '#/components/panel'
import { ProvenanceSource } from '#/components/provenance'
import { EmptyState, ErrorState, LoadingState } from '#/components/states'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSymbol } from '#/components/table'
import { formatDate, formatDateTime, formatNumber, formatRm, formatVolume } from '#/lib/format'
import { DISCOVERY_PROSPECTUS_IDS, DISCOVERY_STOCK_CODES } from './discovery-examples'

/** Decimal conversion at the display boundary; missing values never become zero. */
export function marketNumber(value: unknown): number | null {
  if (typeof value === 'string') {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return null
    value = Number(value)
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const control = 'h-7 rounded-md border border-control-border bg-surface-2 px-2 text-xs hover:bg-surface-3 aria-pressed:border-primary aria-pressed:bg-accent-soft aria-pressed:text-primary'

function ReadState<T>({ query, empty, children }: { query: UseQueryResult<T>; empty: boolean; children: ReactNode }) {
  if (query.data === undefined) {
    if (query.isError) return <ErrorState title="Panel unavailable" onRetry={() => void query.refetch()} />
    return <LoadingState />
  }
  return <>
    {query.isError && <ErrorState title="Refresh failed — showing retained data" onRetry={() => void query.refetch()} />}
    {query.isFetching && <p role="status" className="text-xs text-fg-3">Refreshing…</p>}
    {empty ? <EmptyState title="No data available" /> : children}
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg-3">
      <span>Retrieved {formatDateTime(new Date(query.dataUpdatedAt))} · Quote time unavailable</span>
      <button type="button" className={control} disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh</button>
    </div>
  </>
}

function HistoryChart({ points }: { points: IndexSeriesPoint[] }) {
  // Unavailable levels remain gaps, not zeroes or lines across missing data.
  const valid = points.map((point) => ({ ...point, value: marketNumber(point.level) }))
  const values = valid.flatMap((point) => point.value === null ? [] : [point.value])
  const min = Math.min(...values)
  const span = Math.max(...values) - min || 1
  return <>
    {values.length ? <svg viewBox="0 0 600 180" role="img" aria-label="Index level history; exact dates and values in the table below" className="my-2 block w-full text-chart-1">
      {valid.map((point, i) => {
        if (point.value === null) return null
        const x = 12 + i / Math.max(1, valid.length - 1) * 576
        const y = 168 - (point.value - min) / span * 156
        const next = valid[i + 1]
        return <g key={`${point.levelDate}-${i}`}>
          {next?.value != null && <line x1={x} y1={y} x2={12 + (i + 1) / Math.max(1, valid.length - 1) * 576} y2={168 - (next.value - min) / span * 156} stroke="currentColor" strokeWidth="2" />}
          <circle cx={x} cy={y} r="3" fill="currentColor"><title>{formatDate(point.levelDate)}: {formatNumber(point.value)}</title></circle>
        </g>
      })}
    </svg> : <EmptyState title="No usable history levels" />}
    <details>
      <summary className="cursor-pointer text-xs text-fg-2">Inspect history dates and values</summary>
      <Table aria-label="Index history dates and values">
        <TableHeader><TableRow><TableHead>History date</TableHead><TableHead numeric>Level</TableHead></TableRow></TableHeader>
        <TableBody>{valid.map((point, i) => <TableRow key={`${point.levelDate}-${i}`}><TableCell>{formatDate(point.levelDate)}</TableCell><TableCell numeric>{formatNumber(point.value)}</TableCell></TableRow>)}</TableBody>
      </Table>
    </details>
  </>
}

function HistoryPanel({ id }: { id?: string }) {
  const [range, setRange] = useState<IndexSeriesRange>('1m')
  const history = useQuery({ ...indexSeriesQuery(id ?? '', range), enabled: Boolean(id) })
  return <Panel title="Index history" className="min-w-0">
    <div role="group" aria-label="History range" className="mb-2 flex gap-1">
      {(['1m', '3m', '1y'] as const).map((value) => <button type="button" key={value} disabled={!id} aria-pressed={range === value} className={control} onClick={() => setRange(value)}>{value}</button>)}
    </div>
    {!id ? <EmptyState title="History unavailable without a headline index" /> : <ReadState query={history} empty={!history.data?.points.length}>
      {history.data && <>
        <p className="mb-1 break-words text-xs">{history.data.name} · {history.data.range}</p>
        <ProvenanceSource value={history.data.provenance} />
        <p className="mt-1 text-xs text-fg-3">History dates are stored calendar dates, not current quote times.</p>
        <HistoryChart points={history.data.points} />
      </>}
    </ReadState>}
  </Panel>
}

function MoversPanel() {
  const [type, setType] = useState<MoversBoardType>('gainers')
  const movers = useQuery(moversQuery({ type, limit: 10 }))
  return <Panel title="Market movers" className="min-w-0">
    <div role="group" aria-label="Movers board" className="mb-2 flex flex-wrap gap-1">
      {(['gainers', 'losers', 'actives'] as const).map((value) => <button type="button" key={value} aria-pressed={type === value} className={control} onClick={() => setType(value)}>{value === 'actives' ? 'Most active' : value === 'gainers' ? 'Gainers' : 'Losers'}</button>)}
    </div>
    <ReadState query={movers} empty={!movers.data?.rows.length}>
      <Table aria-label="Market movers">
        <TableHeader><TableRow><TableHead>Stock</TableHead><TableHead numeric>Price</TableHead><TableHead numeric>Change</TableHead><TableHead numeric>Volume (shares)</TableHead><TableHead>Source</TableHead></TableRow></TableHeader>
        <TableBody>{movers.data?.rows.map((row) => <TableRow key={row.stockCode}>
          <TableCell><Link to="/stocks/$code" params={{ code: row.stockCode }} className="hover:underline"><TableSymbol code={row.stockCode} name={row.shortName} /></Link></TableCell>
          <TableCell numeric>{formatRm(marketNumber(row.price), { decimals: 3 })}</TableCell>
          <TableCell numeric><ChangeChip value={marketNumber(row.pctChange)} /></TableCell>
          <TableCell numeric>{formatVolume(marketNumber(row.volume))}</TableCell>
          <TableCell><ProvenanceSource value={row.provenance} /></TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </ReadState>
  </Panel>
}

function SectorsPanel() {
  const sectors = useQuery(sectorsQuery())
  return <Panel title="Sector board" className="min-w-0">
    <ReadState query={sectors} empty={!sectors.data?.sectors.length}>
      <Table aria-label="Sector board">
        <TableHeader><TableRow><TableHead>Sector</TableHead><TableHead numeric>Level</TableHead><TableHead numeric>Change</TableHead><TableHead>Source</TableHead></TableRow></TableHeader>
        <TableBody>{sectors.data?.sectors.map((sector) => <TableRow key={sector.indexId}>
          <TableCell>{sector.sectorName}</TableCell><TableCell numeric>{formatNumber(marketNumber(sector.level))}</TableCell>
          <TableCell numeric><ChangeChip value={marketNumber(sector.pctChange)} /></TableCell><TableCell><ProvenanceSource value={sector.provenance} /></TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </ReadState>
  </Panel>
}

function PreviewRead<T>({ query, children, error }: { query: UseQueryResult<T>; children: (data: T) => ReactNode; error: string }) {
  if (query.data === undefined) {
    return query.isError
      ? <ErrorState title={error} message="This configured example could not be loaded." onRetry={() => void query.refetch()} />
      : <LoadingState label="Loading verified example…" />
  }
  return <>
    {query.isError && <ErrorState title="Refresh failed — showing retained preview" onRetry={() => void query.refetch()} />}
    {query.isFetching && <p role="status" className="text-xs text-fg-3">Refreshing preview…</p>}
    {children(query.data)}
  </>
}

function StockDiscoveryCard({ code }: { code: string }) {
  const identity = useQuery(stockCoreQuery(code))
  const technical = useQuery(stockTechnicalAnalysisQuery(code))
  const fundamental = useQuery(stockFundamentalAnalysisQuery(code))
  return <article className="border-b border-border py-2 last:border-0">
    <Link to="/stocks/$code" params={{ code }} className="font-medium text-fg hover:underline">{code} · {identity.data?.identity.shortName ?? 'Stock'}</Link>
    {identity.data && <p className="m-0 text-xs text-fg-3">{identity.data.identity.companyName} · {identity.data.identity.board} · {identity.data.identity.sector}</p>}
    {identity.isError && <ErrorState title="Stock identity unavailable" onRetry={() => void identity.refetch()} />}
    <div className="mt-1 space-y-1 text-xs text-fg-2">
      <PreviewRead query={technical} error="Stock analysis preview unavailable">{summary => <p className="m-0">Technical analysis: {summary.status}{summary.headline ? ` · ${summary.headline}` : ''}{summary.asOf ? ` · ${formatDate(summary.asOf)}` : ''}</p>}</PreviewRead>
      <PreviewRead query={fundamental} error="Stock analysis preview unavailable">{summary => <p className="m-0">Fundamental analysis: {summary.status}{summary.headline ? ` · ${summary.headline}` : ''}{summary.asOf ? ` · ${formatDate(summary.asOf)}` : ''}</p>}</PreviewRead>
    </div>
  </article>
}

function StockDiscoveryPanel() {
  return <Panel title="Automatic stock analysis">
    <p className="mb-2 text-xs text-fg-3">Curated examples are system-precomputed; opening or refreshing a preview never starts analysis. Search and market movers may include stocks outside this coverage.</p>
    {DISCOVERY_STOCK_CODES.map(code => <StockDiscoveryCard key={code} code={code} />)}
  </Panel>
}

function ProspectusDiscoveryCard({ prospectusId }: { prospectusId: string }) {
  const query = useQuery(prospectusAtAGlanceQuery(prospectusId))
  return <PreviewRead query={query} error="Prospectus preview unavailable">
    {summary => summary.prospectusId !== prospectusId
      ? <ErrorState title="Prospectus preview unavailable" message="The returned summary does not match this configured example." onRetry={() => void query.refetch()} />
      : <article>
        <Link to="/ipo/$prospectusId" params={{ prospectusId }} className="font-medium text-fg hover:underline">{summary.companyName}</Link>
        <p className="m-0 mt-1 text-sm">{summary.headline}</p>
        <p className="m-0 mt-1 text-xs text-fg-3">Precomputed summary · As of {formatDate(summary.asOf)}{summary.listingDate ? ` · Listing ${formatDate(summary.listingDate)}` : ''}</p>
      </article>}
  </PreviewRead>
}

function ProspectusDiscoveryPanel() {
  return <Panel title="Prospectus at a glance">
    <p className="mb-2 text-xs text-fg-3">Prepared prospectus summaries from stored source documents; details are available on each reader page.</p>
    {DISCOVERY_PROSPECTUS_IDS.map(prospectusId => <ProspectusDiscoveryCard key={prospectusId} prospectusId={prospectusId} />)}
  </Panel>
}

export function MarketOverview() {
  const indices = useQuery(indicesQuery())
  const headline = indices.data?.indices.find((index) => index.kind === 'headline')
  return <div className="min-w-0 space-y-3 p-3">
    <h1 className="text-lg font-semibold">Market overview</h1>
    <div className="grid min-w-0 gap-3 lg:grid-cols-[1fr_2fr]">
      <Panel title="Headline snapshot" className="min-w-0">
        <ReadState query={indices} empty={!headline}>
          {headline && <>
            <h2 className="break-words text-base font-semibold">{headline.name}</h2>
            <p className="num my-2 text-2xl">{formatNumber(marketNumber(headline.level))}</p>
            <ChangeChip value={marketNumber(headline.pctChange)} />
            <div className="mt-2"><ProvenanceSource value={headline.provenance} /></div>
          </>}
        </ReadState>
      </Panel>
      <HistoryPanel id={headline?.id.trim() || undefined} />
    </div>
    <div className="grid min-w-0 gap-3 xl:grid-cols-2"><MoversPanel /><SectorsPanel /></div>
    <div className="grid min-w-0 gap-3 md:grid-cols-2">
      <StockDiscoveryPanel />
      <ProspectusDiscoveryPanel />
    </div>
  </div>
}
