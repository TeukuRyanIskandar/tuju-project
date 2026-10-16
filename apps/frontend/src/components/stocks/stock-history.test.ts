import { describe, expect, it } from 'vitest'
import { historyWindow, parseHistory, stockNumber, tradingDate } from './stock-history'

describe('stock history display boundary', () => {
  it.each([null, undefined, '', ' ', '1oops', '0x10', '1,000', 'Infinity', NaN, Infinity, true])('rejects malformed numeric %j', value => {
    expect(stockNumber(value)).toBeNull()
  })
  it.each([['0', 0], [' 12.50 ', 12.5], ['.25', .25], ['1e3', 1000], [3, 3]])('accepts complete finite numeric %j', (value, expected) => {
    expect(stockNumber(value)).toBe(expected)
  })
  it.each(['2026-02-29', '2026-13-01', '2026-04-31', '2026-1-01', '2026-01-01T00:00:00Z', null])('rejects non trading date %j', value => {
    expect(tradingDate(value)).toBeNull()
  })
  it('preserves real date-only days, sorts and exposes conflicting duplicates as gaps', () => {
    expect(tradingDate('2024-02-29')).toBe('2024-02-29')
    expect(parseHistory([
      { date: '2026-10-03', close: '2', volume: '0' },
      { date: '2026-10-01', close: '0', volume: '12' },
      { date: '2026-10-02', close: 'bad', volume: '-1' },
      { date: '2026-10-03', close: '3', volume: '0' },
      { date: 'not-a-day', close: '10', volume: '10' }, null,
    ])).toEqual([
      { date: '2026-10-01', close: 0, volume: 12 },
      { date: '2026-10-02', close: null, volume: null },
      { date: '2026-10-03', close: null, volume: null },
    ])
    expect(parseHistory(undefined)).toEqual([])
  })
  it('anchors local calendar windows to the latest stored day with month-end clamping', () => {
    const points = parseHistory(['2024-03-31', '2025-03-30', '2025-03-31', '2025-12-31', '2026-02-27', '2026-02-28', '2026-03-31'].map(date => ({ date, close: '1', volume: '0' })))
    expect(historyWindow(points, '1M').map(p => p.date)).toEqual(['2026-02-28', '2026-03-31'])
    expect(historyWindow(points, '3M')[0]?.date).toBe('2025-12-31')
    expect(historyWindow(points, '1Y')[0]?.date).toBe('2025-03-31')
    expect(historyWindow(points, '2Y')[0]?.date).toBe('2024-03-31')
    expect(historyWindow([], '1Y')).toEqual([])
  })
})
