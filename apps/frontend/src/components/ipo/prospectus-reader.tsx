import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { ProspectusArtifact, ProspectusRouting } from '@tuju/contracts'
import { prospectusResults } from '#/api/analysis-results'
import { Panel } from '#/components/panel'
import { ProvenanceBadge } from '#/components/provenance'
import { EmptyState, ErrorState, LoadingState } from '#/components/states'
import { formatDate, formatDateTime, MISSING } from '#/lib/format'
import { useAnalysisLifecycle } from '#/components/stocks/use-stock-analysis'

const control = 'h-7 rounded-md border border-control-border bg-surface-2 px-2 text-xs hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-60'

function value(value: string | null | undefined) {
  return value || MISSING
}

function Limitation({ routing }: { routing: ProspectusRouting }) {
  if (routing.source === 'located' && !routing.truncated) return null
  const messages = [
    routing.source === 'fallback' ? 'This section used a document-wide extraction fallback.' : null,
    routing.truncated ? 'The source text was truncated before analysis.' : null,
  ].filter(Boolean)
  return <p className="mt-2 border-l-[3px] border-warn pl-2 text-xs text-fg-2"><strong>Extraction limitation.</strong> {messages.join(' ')}</p>
}

function Detail({ title, children }: { title: string; children: React.ReactNode }) {
  return <details className="border-t border-border first:border-t-0">
    <summary className="cursor-pointer py-2 text-sm font-medium text-fg hover:text-primary">{title}</summary>
    <div className="pb-3 text-sm">{children}</div>
  </details>
}

function List({ items, empty = 'Not available in this analysis.' }: { items: string[]; empty?: string }) {
  if (!items.length) return <p className="text-xs text-fg-3">{empty}</p>
  return <ul className="space-y-1 pl-4 text-sm marker:text-fg-3">{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
}

function Offer({ artifact }: { artifact: ProspectusArtifact }) {
  const { data, routing } = artifact.sections.offer
  const facts = [
    ['Total shares', data.totalShares], ['Public issue', data.publicIssueShares], ['Offer for sale', data.offerForSaleShares],
    ['Price', data.priceRange], ['Market cap at IPO', data.marketCapAtIpo], ['Gross proceeds', data.grossProceeds],
  ]
  return <Panel title="Offer details" className="min-w-0">
    <p>{value(data.summary)}</p>
    <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
      {facts.map(([label, fact]) => <div key={label}><dt className="text-xs text-fg-3">{label}</dt><dd className="m-0 num">{value(fact)}</dd></div>)}
    </dl>
    <Detail title="Use of proceeds">
      {data.useOfProceeds.length ? <div className="overflow-x-auto" role="region" aria-label="Use of proceeds table" tabIndex={0}><table className="min-w-[420px] text-left text-sm"><thead className="text-xs text-fg-3"><tr><th className="pr-4">Purpose</th><th className="pr-4">Amount</th><th>Share of proceeds</th></tr></thead><tbody>{data.useOfProceeds.map((item, index) => <tr key={`${item.purpose}-${index}`} className="border-t border-border"><td className="py-1.5 pr-4">{item.purpose}</td><td className="py-1.5 pr-4 num">{value(item.amount)}</td><td className="py-1.5 num">{value(item.percentOfProceeds)}</td></tr>)}</tbody></table></div> : <p className="text-xs text-fg-3">No use-of-proceeds items were extracted.</p>}
    </Detail>
    <Limitation routing={routing} />
  </Panel>
}

function Financials({ artifact }: { artifact: ProspectusArtifact }) {
  const { data, routing } = artifact.sections.financials
  return <Panel title="Financials" className="min-w-0">
    <p>{data.trend}</p>
    <p className="mt-1 text-xs text-fg-3">Currency: {value(data.currency)} · Extracted values are preserved as reported.</p>
    {data.periods.length ? <div className="mt-3 overflow-x-auto" role="region" aria-label="Financial period comparison" tabIndex={0}><table className="min-w-[580px] w-full text-left text-sm"><thead className="bg-surface-2 text-xs text-fg-3"><tr><th className="p-2">Period</th><th className="p-2">Revenue</th><th className="p-2">Gross profit</th><th className="p-2">Profit after tax</th><th className="p-2">Net margin</th></tr></thead><tbody>{data.periods.map(period => <tr key={period.period} className="border-t border-border"><th className="p-2 text-left font-medium">{period.period}</th><td className="p-2 num">{value(period.revenue)}</td><td className="p-2 num">{value(period.grossProfit)}</td><td className="p-2 num">{value(period.profitAfterTax)}</td><td className="p-2 num">{value(period.netMargin)}</td></tr>)}</tbody></table></div> : <EmptyState title="No financial periods extracted" />}
    <Detail title="Financial highlights"><List items={data.highlights} empty="No financial highlights were extracted." /></Detail>
    <Limitation routing={routing} />
  </Panel>
}

function Risks({ artifact }: { artifact: ProspectusArtifact }) {
  const { data, routing } = artifact.sections.riskFactors
  return <Panel title="Risk themes">
    {data.summary && <p>{data.summary}</p>}
    {data.themes.length ? <ol className="mt-3 space-y-2">{data.themes.map(theme => <li key={`${theme.rank}-${theme.theme}`} className="border-l-2 border-border-strong pl-2"><p className="m-0 font-medium">{theme.rank}. {theme.theme} <span className="text-xs text-fg-3">· {theme.severity} severity</span></p>{theme.summary && <p className="m-0 mt-0.5 text-sm text-fg-2">{theme.summary}</p>}</li>)}</ol> : <EmptyState title="No risk themes extracted" />}
    <Limitation routing={routing} />
  </Panel>
}

function Insights({ artifact }: { artifact: ProspectusArtifact }) {
  const { shariah, cornerstone, lockup, relatedParty } = artifact.insights
  return <Panel title="Supporting insights">
    <Detail title="Shariah status"><p className="m-0 capitalize">{shariah.status} <span className="text-xs text-fg-3">· Source: {shariah.source}</span></p>{shariah.note && <p className="mt-1 text-sm text-fg-2">{shariah.note}</p>}</Detail>
    <Detail title="Cornerstone investors">
      {cornerstone.present ? <><p>{value(cornerstone.summary)}</p><List items={cornerstone.investors.map(investor => `${investor.name}${investor.allocation ? ` · ${investor.allocation}` : ''}${investor.notes ? ` · ${investor.notes}` : ''}`)} /></> : <p className="text-xs text-fg-3">Not identified in this analysis.</p>}
      {cornerstone.truncated && <p className="mt-2 border-l-[3px] border-warn pl-2 text-xs text-fg-2"><strong>Extraction limitation.</strong> The source text was truncated before analysis.</p>}
    </Detail>
    <Detail title="Lock-up / moratorium">
      {!lockup ? <p className="text-xs text-fg-3">Not available in this analysis.</p> : lockup.present ? <><p>{value(lockup.summary)}</p><List items={lockup.entries.map(entry => `${entry.name}${entry.shares ? ` · ${entry.shares}` : ''}${entry.duration ? ` · ${entry.duration}` : ''}${entry.notes ? ` · ${entry.notes}` : ''}`)} /><Limitation routing={lockup.routing} /></> : <p className="text-xs text-fg-3">Not identified in this analysis.</p>}
    </Detail>
    <Detail title="Related-party transactions">
      {!relatedParty ? <p className="text-xs text-fg-3">Not available in this analysis.</p> : relatedParty.present ? <><p>{value(relatedParty.summary)}</p><p className="text-xs text-fg-3">Aggregate amount: {value(relatedParty.aggregateAmount)}</p><List items={relatedParty.items.map(item => `${item.counterparty}${item.nature ? ` · ${item.nature}` : ''}${item.amount ? ` · ${item.amount}` : ''}${item.basis ? ` · ${item.basis}` : ''}`)} /><Limitation routing={relatedParty.routing} /></> : <p className="text-xs text-fg-3">Not identified in this analysis.</p>}
    </Detail>
  </Panel>
}

export function ProspectusArtifactView({ artifact }: { artifact: ProspectusArtifact }) {
  const { business, whatToWatch } = artifact.sections
  return <>
    <nav aria-label="Prospectus sections" className="flex flex-wrap gap-x-3 gap-y-1 border-y border-border py-2 text-xs text-fg-2">
      <a href="#business" className="hover:text-primary hover:underline">Business</a>
      <a href="#offer" className="hover:text-primary hover:underline">Offer</a>
      <a href="#financials" className="hover:text-primary hover:underline">Financials</a>
      <a href="#risks" className="hover:text-primary hover:underline">Risks</a>
      <a href="#watch" className="hover:text-primary hover:underline">What to watch</a>
    </nav>
    <div className="grid gap-3 lg:grid-cols-2">
      <div id="business"><Panel title="Business"><List items={business.data.lines} /><Limitation routing={business.routing} /></Panel></div>
      <div id="watch"><Panel title="What to watch"><p className="font-medium">{whatToWatch.data.headline}</p><ol className="mt-3 space-y-2">{whatToWatch.data.items.map((item, index) => <li key={`${item.point}-${index}`}><p className="m-0">{item.point}</p>{item.why && <p className="m-0 text-xs text-fg-2">{item.why}</p>}{item.sourceSection && <p className="m-0 text-xs text-fg-3">Analysis source section: {item.sourceSection} (not a verified page citation)</p>}</li>)}</ol></Panel></div>
    </div>
    <div id="offer"><Offer artifact={artifact} /></div>
    <div id="financials"><Financials artifact={artifact} /></div>
    <div id="risks"><Risks artifact={artifact} /></div>
    <Insights artifact={artifact} />
  </>
}

export function ProspectusReader({ prospectusId }: { prospectusId: string }) {
  const client = useQueryClient()
  const lifecycle = useMemo(() => prospectusResults(client, prospectusId), [client, prospectusId])
  const { state, refresh } = useAnalysisLifecycle(lifecycle)
  const artifact = state.detail.status === 'matched' ? state.detail.pair.artifact : state.previousPair?.artifact
  const retainedArtifact = Boolean(artifact && state.detail.status !== 'matched')
  const summary = state.summary
  return <div className="min-w-0 space-y-3 p-3">
    <Link to="/" className="text-xs text-fg-2 hover:underline">← Back to market</Link>
    <Panel title="Prospectus at a glance" meta={<button type="button" className={control} disabled={state.refreshingSummary || state.detail.status === 'loading'} onClick={() => void refresh()}>Refresh results</button>}>
      <h1 className="mb-1 break-words text-xl font-semibold">Prospectus at a glance</h1>
      <p className="mb-2 break-words text-sm text-fg-2">{artifact?.company.name ?? summary?.prospectusId ?? `Prospectus ${prospectusId}`}</p>
      {artifact ? <><div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-2"><span>Board: {value(artifact.company.board)}</span><span>Listing date: {formatDate(artifact.company.listingDate)}</span><span>Offer price: {value(artifact.sections.offer.data.priceRange)}</span></div><ProvenanceBadge kind="ai" label="AI-generated analysis" /><p className="mt-2 text-base font-medium">{artifact.headline}</p><p className="mt-2 text-xs text-fg-3">Generated {formatDateTime(artifact.provenance.generatedAt)} · Prospectus source</p>{retainedArtifact && <p role="status" className="mt-2 border-l-[3px] border-warn pl-2 text-xs text-fg-2"><strong>Retained previous analysis — not current.</strong> The latest detail read failed or did not match; this cached artifact is shown with its original result date.</p>}</> : summary ? <><ProvenanceBadge kind="ai" label="AI-generated analysis" /><p className="mt-2 text-base font-medium">{summary.headline}</p></> : state.summaryError ? <ErrorState title="Prospectus analysis unavailable" onRetry={() => void refresh()} /> : <LoadingState label="Loading prospectus analysis…" />}
      {Boolean(state.summaryError) && summary && <ErrorState className="mt-3" title="Refresh failed — showing retained summary" onRetry={() => void refresh()} />}
    </Panel>
    {artifact ? <ProspectusArtifactView artifact={artifact} /> : state.detail.status === 'loading' ? <Panel title="Prospectus detail"><LoadingState label="Loading at-a-glance detail…" /></Panel> : state.detail.status === 'error' ? <Panel title="Prospectus detail"><ErrorState title="Prospectus detail unavailable" message="The summary remains available above." onRetry={() => void refresh()} /></Panel> : state.detail.status === 'mismatch' ? <Panel title="Prospectus detail"><ErrorState title="Result changed while loading" message="Refresh to read the latest coherent result." onRetry={() => void refresh()} /></Panel> : state.detail.status === 'unavailable' ? <Panel title="Prospectus detail"><EmptyState title="Prospectus detail unavailable" description="No completed analysis artifact is available." /></Panel> : null}
  </div>
}
