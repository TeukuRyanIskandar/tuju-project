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
// `scale` picks the number, `unit` stays the suffix: a `fraction` metric is
// stored as a fraction of its unit (0.045 with unit `%` is 4.5%), while a
// `percentage_point` or `absolute` one already is in whole units. This is the
// rule the worker's `generate_fa_headline` uses (`ta_fa_analysis.py`), and both
// sides derive the number from `scale` alone so the headline cannot disagree
// with this panel about a value. Nothing here may branch on the metric's id:
// ids are labels, not numeric conventions.
export function metricValue(metric: FundamentalMetric) {
  const { value, unit, scale } = metric
  if (value == null || !Number.isFinite(value)) return `Unavailable · unit: ${unit}`
  const shown = scale === 'fraction' ? value * 100 : value
  if (unit === '%') return `${factValue(shown)}%`
  if (unit === 'x') return `${factValue(shown)} ${unit}`
  // No rendering rule for this unit, so show the number rather than guess one:
  // "unconverted" refers to the unit, not to the scale applied above.
  return `${factValue(shown)} · unit: ${unit} (unconverted)`
}
export function isFactsOnly(summary: { status: string; headline: string | null }, narrative?: string) {
  return summary.status === 'facts_only' || summary.headline?.startsWith('facts-only: ') === true
    || narrative === 'Narrative withheld: narration stopped by cost guard.'
    || narrative === 'Narrative withheld: failed the grounding check.'
}
