import { expect, it } from 'vitest'
import { analysisDate, factValue, isFactsOnly, metricIds, metricValue } from './analysis-presentation'
import type { FundamentalMetric } from '@tuju/contracts'

const metric = (id: FundamentalMetric['id'], value: number | null, unit: string, scale: FundamentalMetric['scale']): FundamentalMetric => ({ id, value, unit, scale, label: 'Metric', asOf: '2026-06-30' })
it.each([
  ['dividend_yield', 0.0567, '%', 'fraction', '5.67%'], ['roe', 0.1134, '%', 'fraction', '11.34%'],
  ['revenue_growth_yoy', 8.4, '%', 'percentage_point', '8.4%'], ['profit_growth_qoq', 1.5, '%', 'percentage_point', '1.5%'],
  ['roe', 2, '%', 'fraction', '200%'], ['profit_growth_yoy', 0, '%', 'percentage_point', '0%'],
  ['trailing_pe', 0, 'x', 'absolute', '0 x'], ['operating_cash_flow', 4200000000, 'RM bn', 'absolute', '4,200,000,000 · unit: RM bn (unconverted)'],
  ['dividend_yield', 0.02, 'x', 'fraction', '2 x'], ['debt_to_equity', 0.5, 'mystery', 'absolute', '0.5 · unit: mystery (unconverted)'],
] as const)('formats %s with explicit unit semantics', (id, value, unit, scale, output) => {
  expect(metricValue(metric(id, value, unit, scale))).toBe(output)
})
// The presentation rule reads `scale` and `unit` only, so the same id presented
// under a different scale must change the number and nothing else. Reinstating an
// id-based branch fails here for whichever id that branch special-cased.
it.each(metricIds)('renders %s from its scale and unit alone, never its id', id => {
  const shown = (unit: string, scale: FundamentalMetric['scale'], value: number) => metricValue(metric(id, value, unit, scale))
  expect(shown('%', 'fraction', 0.05)).toBe('5%')
  expect(shown('%', 'percentage_point', 0.05)).toBe('0.05%')
  expect(shown('%', 'absolute', 0.05)).toBe('0.05%')
  expect(shown('x', 'fraction', 0.02)).toBe('2 x')
  expect(shown('x', 'percentage_point', 2)).toBe('2 x')
  expect(shown('x', 'absolute', 2)).toBe('2 x')
})
it('keeps null, zero, false and unknown units distinct', () => {
  expect(factValue(null)).toBe('Unavailable')
  expect(factValue(0)).toBe('0')
  expect(factValue(false)).toBe('false')
  expect(metricValue(metric('roe', 2, 'mystery', 'absolute'))).toBe('2 · unit: mystery (unconverted)')
  expect(metricValue(metric('roe', null, '%', 'fraction'))).toBe('Unavailable · unit: %')
})
it('keeps calendar dates and UTC instants stable across host timezones', () => {
  expect(analysisDate('2026-06-30')).toBe('2026-06-30')
  expect(analysisDate('2026-10-08T00:00:00+08:00')).toBe('2026-10-07T16:00:00.000Z (UTC)')
  expect(analysisDate(null)).toBe('Unavailable')
  expect(analysisDate('bad')).toBe('Unavailable')
})
it.each(['stale', 'failed', 'ready'])('recognizes degraded narration even under %s', status => {
  expect(isFactsOnly({ status, headline: 'facts-only: Grounding check failed.' })).toBe(true)
  for (const narrative of ['Narrative withheld: narration stopped by cost guard.', 'Narrative withheld: failed the grounding check.']) {
    expect(isFactsOnly({ status, headline: null }, narrative)).toBe(true)
  }
  expect(isFactsOnly({ status, headline: 'Normal summary' }, 'Normal explanation')).toBe(false)
  expect(isFactsOnly({ status: 'facts_only', headline: null })).toBe(true)
})
