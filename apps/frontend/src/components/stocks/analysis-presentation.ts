import type { FundamentalMetric, FundamentalMetricId } from '@tuju/contracts'

export const metricLabels: Record<FundamentalMetricId, string> = {
  trailing_pe: 'Trailing P/E', dividend_yield: 'Dividend yield', roe: 'Return on equity',
  revenue_growth_qoq: 'Revenue growth QoQ', revenue_growth_yoy: 'Revenue growth YoY',
  profit_growth_qoq: 'Profit growth QoQ', profit_growth_yoy: 'Profit growth YoY',
  debt_to_equity: 'Debt to equity', operating_cash_flow: 'Operating cash flow',
}
export const metricIds = Object.keys(metricLabels) as FundamentalMetricId[]
export function analysisDate(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Unavailable'
  // Date-only facts are calendar dates, not local-midnight instants.
  return value.length === 10 ? value : `${new Date(value).toISOString()} (UTC)`
}
export function factValue(value: number | string | boolean | null | undefined) {
  if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return 'Unavailable'
  return typeof value === 'number' ? new Intl.NumberFormat('en-MY', { maximumFractionDigits: 4 }).format(value) : String(value)
}
export function metricValue(metric: FundamentalMetric) {
  const { id, value, unit } = metric
  if (value == null || !Number.isFinite(value)) return `Unavailable · unit: ${unit}`
  const percentage = unit === 'percent' || (unit === '%' && (id === 'dividend_yield' || id === 'roe'))
  if (percentage) return `${factValue(value * 100)}%`
  if (unit === '%' && id.includes('_growth_')) return `${factValue(value)}%`
  if (unit === 'ratio' || unit === 'x') return `${factValue(value)} ${unit}`
  if (unit === 'MYR' || unit === 'myr' || unit === 'RM') return `${unit} ${factValue(value)}`
  return `${factValue(value)} · unit: ${unit} (unconverted)`
}
export function isFactsOnly(summary: { status: string; headline: string | null }, narrative?: string) {
  return summary.status === 'facts_only' || summary.headline?.startsWith('facts-only: ') === true
    || narrative === 'Narrative withheld: narration stopped by cost guard.'
    || narrative === 'Narrative withheld: failed the grounding check.'
}
