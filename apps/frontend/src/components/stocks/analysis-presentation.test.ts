import { expect, it } from 'vitest'
import { analysisDate, factValue, isFactsOnly, metricValue } from './analysis-presentation'
import type { FundamentalMetric } from '@tuju/contracts'

const metric = (id: FundamentalMetric['id'], value: number | null, unit: string, scale: FundamentalMetric['scale']): FundamentalMetric => ({ id, value, unit, scale, label: 'Metric', asOf: '2026-06-30' })
it.each([
  ['dividend_yield', 0.0567, 'percent', 'fraction', '5.67%'], ['roe', 0.1134, '%', 'fraction', '11.34%'],
  ['revenue_growth_yoy', 8.4, '%', 'percentage_point', '8.4%'], ['profit_growth_qoq', 0.015, 'percent', 'percentage_point', '1.5%'],
  ['roe', 2, '%', 'fraction', '200%'], ['profit_growth_yoy', 0, '%', 'percentage_point', '0%'],
  ['trailing_pe', 0, 'x', 'absolute', '0 x'], ['operating_cash_flow', 4200000000, 'RM bn', 'absolute', '4,200,000,000 · unit: RM bn (unconverted)'],
] as const)('formats %s with explicit unit semantics', (id, value, unit, scale, output) => {
  expect(metricValue(metric(id, value, unit, scale))).toBe(output)
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
