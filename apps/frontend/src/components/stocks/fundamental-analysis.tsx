import type { StockFundamentalAnalysisArtifact } from '@tuju/contracts'
import { analysisDate, metricIds, metricLabels, metricValue } from './analysis-presentation'

export function FundamentalAnalysis({ artifact: a }: { artifact: StockFundamentalAnalysisArtifact }) {
  return <>
    <p>Period: {a.period} · As of {analysisDate(a.asOf)}</p>
    <h3 className="mt-3 font-semibold">Computed facts</h3>
    <dl className="space-y-2">{metricIds.map(id => {
      const matches = a.metrics.filter(metric => metric.id === id)
      const metric = matches.length === 1 ? matches[0] : undefined
      return <div key={id} className="border-b border-border py-1"><dt>{metricLabels[id]}</dt>
        <dd className="num">{metric ? metricValue(metric) : 'Unavailable — missing or duplicate metric'}</dd>
        <dd className="text-xs text-fg-3">{id} · {metric ? `Unit: ${metric.unit} · Metric date: ${analysisDate(metric.asOf)}` : 'Metric date unavailable'}</dd>
      </div>
    })}</dl>
  </>
}
