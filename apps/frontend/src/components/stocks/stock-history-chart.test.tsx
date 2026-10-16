import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { StockHistoryChart } from './stock-history-chart'
import { parseHistory } from './stock-history'

it.each([{ input: [] }, { input: [{ date: '2026-10-01', close: 'bad', volume: '0' }] }])('offers table fallback without fabricated prices for %j', async ({ input }) => {
  render(<StockHistoryChart points={parseHistory(input)} />)
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(screen.getByText('No usable close prices in this window')).toBeInTheDocument()
  const summary = screen.getByText('Inspect daily data table')
  summary.focus()
  await userEvent.keyboard('{Enter}')
  expect(screen.getByRole('table')).toBeInTheDocument()
})

it.each([{ values: ['0'] }, { values: ['5'] }, { values: ['5', '5'] }, { values: ['1e308', '1e307'] }])('plots finite coordinates for single, zero, flat or large series %j', ({ values }) => {
  render(<StockHistoryChart points={parseHistory(values.map((close, i) => ({ date: `2026-10-0${i + 1}`, close, volume: '0' })))} />)
  const chart = screen.getByRole('img')
  expect(chart.outerHTML).not.toMatch(/NaN|Infinity/)
  expect(chart.querySelectorAll('circle')).toHaveLength(values.length)
})

it('does not draw a price line across a malformed close or ambiguous duplicate day', () => {
  render(<StockHistoryChart points={parseHistory([
    { date: '2026-10-01', close: '1', volume: '0' },
    { date: '2026-10-02', close: '', volume: '5' },
    { date: '2026-10-03', close: '2', volume: '5' },
    { date: '2026-10-03', close: '2', volume: '5' },
    { date: '2026-10-04', close: '3', volume: '5' },
  ])} />)
  const chart = screen.getByRole('img')
  expect(chart.querySelectorAll('circle')).toHaveLength(2)
  expect(chart.querySelectorAll('line[stroke="currentColor"]')).toHaveLength(0)
})

it('colours volume by the preceding stored close and labels unknown/equal direction', () => {
  render(<StockHistoryChart points={parseHistory([
    { date: '2026-10-01', close: '10', volume: '10' },
    { date: '2026-10-02', close: 'bad', volume: '20' },
    { date: '2026-10-03', close: '11', volume: '30' },
    { date: '2026-10-04', close: '11', volume: '40' },
    { date: '2026-10-05', close: '9', volume: 'bad' },
    { date: '2026-10-06', close: '8', volume: '50' },
  ])} />)
  const chart = screen.getByRole('img')
  const bars = [...chart.querySelectorAll('rect[fill="var(--up)"], rect[fill="var(--down)"], rect[fill="var(--unch)"]')]
  expect(bars).toHaveLength(4)
  expect(bars.map(bar => bar.getAttribute('fill'))).toEqual([
    'var(--unch)', 'var(--unch)', 'var(--unch)', 'var(--down)',
  ])
  expect(chart).toHaveTextContent('▲ higher close · ▼ lower close · • unchanged / unknown')
  expect(chart.querySelector('[aria-label="Volume 10; unknown close"]')).toBeInTheDocument()
  expect(chart.querySelector('[aria-label="Volume 40; unchanged close"]')).toBeInTheDocument()
  expect(chart.querySelectorAll('line[stroke="var(--border)"]')).toHaveLength(10)
  expect(chart.querySelector('rect[fill="var(--surface-2)"]')).toHaveAttribute('opacity', '0.35')
})
